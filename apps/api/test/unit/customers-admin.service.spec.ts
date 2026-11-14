import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CustomersAdminService } from '../../src/modules/admin-tools/customers-admin.service';

describe('CustomersAdminService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: CustomersAdminService;

  const user = {
    id: 'u1', fullName: 'Mohamed Ahmed', phone: '+22222123456', email: null, country: 'MR', city: 'Nouakchott',
    adminNote: null, tags: [], phoneVerifiedAt: null, isBlocked: false, createdAt: new Date('2026-01-01'), lastLoginAt: null,
  };

  beforeEach(() => {
    tx = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ adminNote: 'old', tags: ['VIP'] }),
        update: jest.fn((a: any) => Promise.resolve({ adminNote: a.data.adminNote ?? 'old', tags: a.data.tags ?? ['VIP'] })),
      },
      order: {
        findUnique: jest.fn().mockResolvedValue({ adminNote: null }),
        update: jest.fn((a: any) => Promise.resolve({ adminNote: a.data.adminNote })),
      },
    };
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(user),
        findMany: jest.fn().mockResolvedValue([{ id: 'staff1', fullName: 'Owner' }]),
      },
      wallet: { findMany: jest.fn().mockResolvedValue([{ currencyCode: 'MRU', balance: new Prisma.Decimal('470') }]) },
      walletTransaction: {
        findMany: jest.fn().mockResolvedValue([
          { id: 't2', type: 'REFUND', amount: new Prisma.Decimal('10'), createdById: null },
          { id: 't1', type: 'ADMIN_ADJUSTMENT', amount: new Prisma.Decimal('500'), createdById: 'staff1' },
        ]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([{ id: 'o1', orderNumber: 'PTN-1' }]),
        count: jest.fn().mockResolvedValue(3),
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 2 }, _sum: { totalBase: new Prisma.Decimal('41.5') }, _max: { createdAt: new Date('2026-10-01') },
        }),
      },
      refund: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', amount: new Prisma.Decimal('5'), currency: 'MRU', status: 'PROCESSED', order: { id: 'o1', orderNumber: 'PTN-1' } },
        ]),
      },
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CustomersAdminService(prisma, audit);
  });

  describe('findOne', () => {
    it('returns the customer with stats and the latest 20 orders', async () => {
      const res = await service.findOne('u1');
      expect(res).toMatchObject({
        id: 'u1', country: 'MR', city: 'Nouakchott',
        stats: { orders: 3, paidOrders: 2, totalSpentBase: '41.50', lastOrderAt: new Date('2026-10-01') },
        orders: [{ id: 'o1', orderNumber: 'PTN-1' }],
      });
      expect(prisma.order.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' }, take: 20 });
      expect(prisma.order.aggregate.mock.calls[0][0].where.status.in).toEqual(['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED']);
      // never the password hash or 2FA secret
      const select = prisma.user.findFirst.mock.calls[0][0].select;
      expect(select).not.toHaveProperty('passwordHash');
      expect(select).not.toHaveProperty('twoFaSecretEnc');
    });

    it('shows the wallet balances and the ledger behind them, with who adjusted by hand', async () => {
      const res: any = await service.findOne('u1');
      expect(res.wallets).toEqual([{ currencyCode: 'MRU', balance: new Prisma.Decimal('470') }]);
      expect(res.ledger.map((l: any) => [l.id, l.by])).toEqual([['t2', null], ['t1', 'Owner']]);
      expect(res.ledger[0]).not.toHaveProperty('createdById');
      expect(prisma.walletTransaction.findMany.mock.calls[0][0]).toMatchObject({ where: { userId: 'u1' }, orderBy: { createdAt: 'desc' }, take: 30 });
    });

    it('reports zero spend for a customer who never paid', async () => {
      prisma.order.aggregate.mockResolvedValue({ _count: { _all: 0 }, _sum: { totalBase: null }, _max: { createdAt: null } });
      const res = await service.findOne('u1');
      expect(res.stats).toEqual({ orders: 3, paidOrders: 0, totalSpentBase: '0.00', lastOrderAt: null });
    });

    it('shows the refunds on their orders, the referring agent and the segments', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...user,
        createdAt: new Date(Date.now() - 200 * 86_400_000),
        referredByAgent: { id: 'ag1', code: 'K7MXQ2', isActive: true, user: { id: 'au', fullName: 'Sidi' } },
        agent: null,
      });
      prisma.order.aggregate.mockResolvedValue({
        _count: { _all: 12 }, _sum: { totalBase: new Prisma.Decimal('80') }, _max: { createdAt: new Date() },
      });
      const res: any = await service.findOne('u1');
      expect(res.refunds).toHaveLength(1);
      expect(prisma.refund.findMany.mock.calls[0][0].where).toEqual({ order: { userId: 'u1' } });
      expect(res.referredByAgent).toMatchObject({ code: 'K7MXQ2' });
      // 12 paid orders ≥ the default 10 → VIP; ordered today → active; joined long ago → not new
      expect(res.segments).toEqual(['active', 'vip']);
    });

    it('404s for a missing or deleted customer', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('cleans the tags (trim, drop empty, once each) and audits the change', async () => {
      await service.update('u1', { tags: [' VIP ', 'vip', '', 'watch'] }, 'admin-1');
      expect(tx.user.update.mock.calls[0][0].data).toEqual({ tags: ['VIP', 'watch'] });
      expect(audit.record.mock.calls[0][1]).toMatchObject({
        actorId: 'admin-1', action: 'customers.update', entityType: 'User', entityId: 'u1', before: { adminNote: 'old', tags: ['VIP'] },
      });
    });

    it('stores an empty or null note as null and leaves the tags alone', async () => {
      await service.update('u1', { adminNote: '   ' }, 'a');
      expect(tx.user.update.mock.calls[0][0].data).toEqual({ adminNote: null });
      await service.update('u1', { adminNote: null }, 'a');
      expect(tx.user.update.mock.calls[1][0].data).toEqual({ adminNote: null });
      await service.update('u1', { adminNote: ' يدفع دائمًا ' }, 'a');
      expect(tx.user.update.mock.calls[2][0].data).toEqual({ adminNote: 'يدفع دائمًا' });
    });

    it('returns the refreshed customer page', async () => {
      const res = await service.update('u1', {}, 'a');
      expect(res.id).toBe('u1');
    });

    it('404s for a missing customer', async () => {
      tx.user.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', { tags: [] }, 'a')).rejects.toThrow(NotFoundException);
    });
  });

  describe('segment settings', () => {
    it('falls back to the defaults, then stores and audits the owner\'s thresholds', async () => {
      expect(await service.segmentSettings()).toEqual({ vipSpendBase: 500, vipOrders: 10 });
      tx.systemSetting = { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) };
      expect(await service.setSegmentSettings({ vipSpendBase: 250, vipOrders: 0 }, 'admin-1')).toEqual({ vipSpendBase: 250, vipOrders: 0 });
      expect(tx.systemSetting.upsert.mock.calls[0][0]).toMatchObject({
        where: { key: 'customers.segments' }, update: { value: { vipSpendBase: 250, vipOrders: 0 } },
      });
      expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'customers.segments', actorId: 'admin-1' });
    });
  });

  describe('setOrderNote', () => {
    it('sets, trims and audits the note', async () => {
      expect(await service.setOrderNote('o1', { note: ' تواصل معه ' }, 'admin-1')).toEqual({ adminNote: 'تواصل معه' });
      expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'orders.note', entityType: 'Order', entityId: 'o1' });
    });

    it('clears the note with null or an empty string', async () => {
      expect(await service.setOrderNote('o1', { note: null }, 'a')).toEqual({ adminNote: null });
      expect(await service.setOrderNote('o1', { note: '' }, 'a')).toEqual({ adminNote: null });
    });

    it('404s for a missing order', async () => {
      tx.order.findUnique.mockResolvedValue(null);
      await expect(service.setOrderNote('nope', { note: 'x' }, 'a')).rejects.toThrow(NotFoundException);
    });
  });
});
