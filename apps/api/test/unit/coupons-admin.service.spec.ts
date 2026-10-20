import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CouponsAdminService } from '../../src/modules/admin-tools/coupons-admin.service';

describe('CouponsAdminService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: CouponsAdminService;

  const stored = {
    id: 'c1', code: 'EID10', discountType: 'PERCENT', discountValue: new Prisma.Decimal(10),
    startsAt: new Date('2026-10-01T00:00:00Z'), expiresAt: null,
  };

  beforeEach(() => {
    tx = {
      coupon: {
        findUnique: jest.fn((a: any) => Promise.resolve(a.where.id === 'c1' ? stored : null)),
        create: jest.fn((a: any) => Promise.resolve({ id: 'new', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ ...stored, ...a.data })),
      },
    };
    prisma = {
      coupon: { findMany: jest.fn().mockResolvedValue([{ id: 'c1', code: 'EID10', usedCount: 3, _count: { orders: 3 } }]) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CouponsAdminService(prisma, audit);
  });

  it('lists coupons with how many orders used each', async () => {
    expect(await service.list()).toEqual([{ id: 'c1', code: 'EID10', usedCount: 3, ordersCount: 3 }]);
  });

  it('creates a coupon with an upper-cased code and audits it', async () => {
    const c: any = await service.create(
      { code: 'ramadan_5', discountType: 'FIXED', discountValue: 5, minOrderTotal: 20, maxUses: 100, expiresAt: '2026-11-01T00:00:00Z' },
      'admin-1',
    );
    expect(c).toMatchObject({ code: 'RAMADAN_5', discountType: 'FIXED', maxUses: 100 });
    expect(c.discountValue.toString()).toBe('5');
    expect(c.minOrderTotal.toString()).toBe('20');
    expect(c.expiresAt).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(audit.record.mock.calls[0][1]).toMatchObject({ actorId: 'admin-1', action: 'coupons.create', entityId: 'new' });
  });

  it('refuses a taken code with 409 COUPON_CODE_TAKEN', async () => {
    tx.coupon.findUnique.mockResolvedValue(stored);
    const err = await service.create({ code: 'EID10', discountType: 'PERCENT', discountValue: 10 }, 'a').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ error: 'COUPON_CODE_TAKEN' });
  });

  it('refuses a percent over 100 and an end before the start', async () => {
    await expect(service.create({ code: 'BIG', discountType: 'PERCENT', discountValue: 150 }, 'a')).rejects.toThrow(BadRequestException);
    await expect(
      service.create(
        { code: 'DATES', discountType: 'FIXED', discountValue: 1, startsAt: '2026-11-02T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' },
        'a',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('pauses a coupon and clears limits with null, auditing before/after', async () => {
    const c: any = await service.update('c1', { isActive: false, maxUses: null, maxDiscount: null, minOrderTotal: null, expiresAt: null }, 'a');
    expect(tx.coupon.update.mock.calls[0][0].data).toEqual({
      isActive: false, maxUses: null, maxDiscount: null, minOrderTotal: null, expiresAt: null,
    });
    expect(c.isActive).toBe(false);
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'coupons.update', before: stored });
  });

  it('checks an update against the stored values', async () => {
    // stored is PERCENT: raising the value past 100 is refused
    await expect(service.update('c1', { discountValue: 120 }, 'a')).rejects.toThrow(BadRequestException);
    // stored starts on Oct 1: an earlier end is refused
    await expect(service.update('c1', { expiresAt: '2026-09-01T00:00:00Z' }, 'a')).rejects.toThrow(BadRequestException);
    // switching to FIXED makes 120 a valid amount
    await expect(service.update('c1', { discountType: 'FIXED', discountValue: 120 }, 'a')).resolves.toBeDefined();
  });

  it('renames a coupon only to a free code', async () => {
    tx.coupon.findUnique.mockImplementation((a: any) =>
      Promise.resolve(a.where.id === 'c1' ? stored : a.where.code === 'TAKEN' ? { id: 'c2' } : null),
    );
    await expect(service.update('c1', { code: 'taken' }, 'a')).rejects.toThrow(ConflictException);
    await expect(service.update('c1', { code: 'free1', startsAt: null, maxDiscount: 3, maxUsesPerUser: 2 }, 'a')).resolves.toMatchObject({ code: 'FREE1' });
    // keeping the same code does not look it up again
    await expect(service.update('c1', { code: 'eid10' }, 'a')).resolves.toMatchObject({ code: 'EID10' });
  });

  it('404s for a missing coupon', async () => {
    await expect(service.update('nope', { isActive: true }, 'a')).rejects.toThrow(NotFoundException);
  });
});
