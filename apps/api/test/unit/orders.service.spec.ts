import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, QuoteStatus } from '@prisma/client';
import { OrdersService } from '../../src/modules/orders/orders.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** An order row shaped for `present()` / findOne. */
const makeOrder = (over: Partial<any> = {}) => ({
  id: 'o1',
  userId: 'u1',
  status: OrderStatus.PENDING_PAYMENT,
  fxRate: D(1),
  couponId: null,
  items: [
    {
      id: 'i1',
      status: 'DELIVERED',
      unitPrice: D(10),
      unitCost: D(4),
      quantity: 2,
      inputs: [
        { fieldKey: 'player', fieldLabel: 'Player', value: 'ABC', isSensitive: false },
        { fieldKey: 'pin', fieldLabel: 'PIN', value: 'enc:1', isSensitive: true },
      ],
      results: [
        { id: 'r1', resultType: 'CODE', viewedAt: null, deliveredAt: new Date('2026-01-01'), providerRef: 'REF1' },
      ],
    },
  ],
  payments: [],
  ...over,
});

const makeQuote = (over: Partial<any> = {}) => ({
  id: 'q1',
  userId: 'u1',
  status: QuoteStatus.ACTIVE,
  expiresAt: new Date(Date.now() + 60_000),
  subtotal: D(20), discount: D(0), fees: D(0), taxAmount: D(0), taxRate: D(0),
  taxInclusive: false, total: D(20), currency: 'USD', baseCurrency: 'USD',
  fxRate: D(1), fxRateId: 'fx1', totalBase: D(20), couponId: null,
  items: [
    {
      productId: 'p1', productNameAr: 'م', productNameEn: 'Product', quantity: 2,
      unitPrice: D(10), unitPriceBase: D(10), unitCostBase: D(4), lineTotal: D(20),
      taxAmount: D(0), plannedProviderId: null,
      inputs: [{ fieldKey: 'player', fieldLabel: 'Player', value: 'ABC', isSensitive: false }],
    },
  ],
  ...over,
});

describe('OrdersService', () => {
  let prisma: any;
  let crypto: any;
  let outbox: any;
  let audit: any;
  let reference: any;
  let tx: any;
  let service: OrdersService;

  beforeEach(() => {
    tx = {
      checkoutQuote: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      order: {
        create: jest.fn().mockResolvedValue({ id: 'o1', total: D(20), currency: 'USD' }),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      orderItem: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      orderResult: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      coupon: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      checkoutQuote: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      order: {
        findUnique: jest.fn().mockResolvedValue(makeOrder()),
        findMany: jest.fn().mockResolvedValue([]),
      },
      orderItem: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    crypto = { decrypt: jest.fn((v: string) => `dec:${v}`) };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    reference = { order: jest.fn().mockResolvedValue('ORD-1') };

    service = new OrdersService(prisma, crypto, outbox, audit, reference);
  });

  describe('createFromQuote', () => {
    const meta = { ip: '1.2.3.4', userAgent: 'jest' };

    it('creates an order copying frozen values and emits an event', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote());

      const res = await service.createFromQuote('u1', 'q1', meta);

      const data = tx.order.create.mock.calls[0][0].data;
      expect(data.total.toString()).toBe('20');
      expect(data.currency).toBe('USD');
      expect(data.status).toBe(OrderStatus.PENDING_PAYMENT);
      expect(data.orderNumber).toBe('ORD-1');
      expect(tx.checkoutQuote.updateMany).toHaveBeenCalled();
      expect(outbox.emit).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'order.created' }));
      expect(prisma.order.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'o1' } }));
      expect(res.items).toBeDefined();
    });

    it('increments coupon usage when the quote carried a coupon', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote({ couponId: 'c1' }));
      await service.createFromQuote('u1', 'q1', meta);
      expect(tx.coupon.update).toHaveBeenCalledWith({
        where: { id: 'c1' }, data: { usedCount: { increment: 1 } },
      });
    });

    it('throws when the quote does not exist', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(null);
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a quote owned by another account', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote({ userId: 'other' }));
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('returns the existing order when a consumed quote already produced one', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote({ status: QuoteStatus.CONSUMED }));
      prisma.order.findUnique.mockResolvedValueOnce({ id: 'o9' }); // the existing-order lookup
      prisma.order.findUnique.mockResolvedValueOnce(makeOrder({ id: 'o9' })); // findOne

      const res = await service.createFromQuote('u1', 'q1', meta);
      expect(res).toBeDefined();
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('rejects a consumed quote with no order behind it', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote({ status: QuoteStatus.CONSUMED }));
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toThrow(/no longer valid/);
    });

    it('rejects a non-active quote', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote({ status: QuoteStatus.CANCELLED }));
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toThrow(/no longer valid/);
    });

    it('expires and rejects an active quote past its deadline', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(
        makeQuote({ status: QuoteStatus.ACTIVE, expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toThrow(/has expired/);
      expect(prisma.checkoutQuote.update).toHaveBeenCalledWith({
        where: { id: 'q1' }, data: { status: QuoteStatus.EXPIRED },
      });
    });

    it('loses the race when the conditional claim updates nothing', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuote());
      tx.checkoutQuote.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.createFromQuote('u1', 'q1', meta)).rejects.toThrow(/already been used or expired/);
      expect(tx.order.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws when the order is missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.findOne('o1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an order owned by another account', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder({ userId: 'other' }));
      await expect(service.findOne('o1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('masks sensitive inputs and hides providerRef for the owner view', async () => {
      const res: any = await service.findOne('o1', 'u1');
      const item = res.items[0];
      expect(item.inputs.find((i: any) => i.fieldKey === 'pin').value).toBe('••••');
      expect(item.inputs.find((i: any) => i.fieldKey === 'player').value).toBe('ABC');
      expect(item.results[0].providerRef).toBeUndefined();
      expect(item.results[0].hasValue).toBe(true);
      expect(item.results[0].revealed).toBe(false);
    });

    it('exposes providerRef for the admin (no user) view', async () => {
      const res: any = await service.findOne('o1');
      expect(res.items[0].results[0].providerRef).toBe('REF1');
    });
  });

  describe('findAllForUser', () => {
    it('fetches limit+1 rows and returns a cursor page', async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({ id: `o${i}`, createdAt: new Date(2026, 0, i + 1) }));
      prisma.order.findMany.mockResolvedValue(rows);
      const res = await service.findAllForUser('u1', { limit: 2, order: 'desc' } as any);
      expect(prisma.order.findMany.mock.calls[0][0].take).toBe(3);
      expect(res.data).toHaveLength(2);
      expect(res.meta.hasMore).toBe(true);
    });

    it('applies a status filter when supplied', async () => {
      await service.findAllForUser('u1', { limit: 20, order: 'desc', status: 'PAID' } as any);
      expect(prisma.order.findMany.mock.calls[0][0].where).toEqual(
        expect.objectContaining({ userId: 'u1', status: 'PAID' }),
      );
    });
  });

  describe('findAllAdmin', () => {
    it('builds a search filter and computes per-order margin', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'o1', createdAt: new Date('2026-01-01'), fxRate: D(1),
          items: [{ unitPrice: D(10), unitCost: D(4), quantity: 2 }],
        },
      ]);
      const res = await service.findAllAdmin({ limit: 20, order: 'desc', search: 'foo', userId: 'u2' } as any);
      const where = prisma.order.findMany.mock.calls[0][0].where;
      expect(where.userId).toBe('u2');
      expect(where.OR).toBeDefined();
      // margin = (10/1 - 4) * 2 = 12
      expect(res.data[0].marginBase.toString()).toBe('12');
    });
  });

  describe('revealResult', () => {
    const item = (over: Partial<any> = {}) => ({
      id: 'i1', status: 'DELIVERED',
      order: { userId: 'u1' },
      results: [{ resultType: 'CODE', valueEnc: 'enc-code', deliveredAt: new Date('2026-01-01') }],
      ...over,
    });

    it('throws when the order item is missing', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(null);
      await expect(service.revealResult('i1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a reveal on another account’s order', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(item({ order: { userId: 'other' } }));
      await expect(service.revealResult('i1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an item that has not been delivered', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(item({ status: 'PROCESSING' }));
      await expect(service.revealResult('i1', 'u1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks results viewed, audits, and returns decrypted values', async () => {
      prisma.orderItem.findUnique.mockResolvedValue(item());
      const res = await service.revealResult('i1', 'u1');
      expect(tx.orderResult.updateMany).toHaveBeenCalledWith({
        where: { orderItemId: 'i1', viewedAt: null }, data: { viewedAt: expect.any(Date) },
      });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'orders.reveal_result' }));
      expect(res[0].value).toBe('dec:enc-code');
    });
  });

  describe('syncStatus', () => {
    it('returns untouched for a terminal-ish status', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({ id: 'o1', status: 'PENDING_PAYMENT', items: [] });
      const res = await service.syncStatus('o1');
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(res.status).toBe('PENDING_PAYMENT');
    });

    it('returns untouched when the derived status matches', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1', status: 'PROCESSING', items: [{ status: 'PENDING' }],
      });
      const res = await service.syncStatus('o1');
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(res.status).toBe('PROCESSING');
    });

    it('transitions, bumps version, sets completedAt and emits when derived differs', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1', userId: 'u1', status: 'PROCESSING', items: [{ status: 'DELIVERED' }],
      });
      tx.order.update.mockResolvedValue({ id: 'o1', status: 'COMPLETED' });
      await service.syncStatus('o1');
      const data = tx.order.update.mock.calls[0][0].data;
      expect(data.status).toBe('COMPLETED');
      expect(data.version).toEqual({ increment: 1 });
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(outbox.emit).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'order.completed' }));
    });

    it('rejects an illegal derived transition', async () => {
      // PAID cannot derive to COMPLETED directly (PAID -> PROCESSING/REFUNDED/CANCELLED)
      tx.order.findUniqueOrThrow.mockResolvedValue({
        id: 'o1', userId: 'u1', status: 'PAID', items: [{ status: 'DELIVERED' }],
      });
      await expect(service.syncStatus('o1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('cancelUnpaid', () => {
    it('cancels the order, its items, releases the coupon and audits', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({ id: 'o1', status: 'PENDING_PAYMENT', couponId: 'c1' });
      tx.order.update.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
      await service.cancelUnpaid('o1', 'fraud', 'admin1');
      expect(tx.orderItem.updateMany).toHaveBeenCalled();
      expect(tx.coupon.update).toHaveBeenCalledWith({
        where: { id: 'c1' }, data: { usedCount: { decrement: 1 } },
      });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'orders.cancel' }));
    });

    it('skips the coupon release when there is no coupon', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({ id: 'o1', status: 'PENDING_PAYMENT', couponId: null });
      tx.order.update.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
      await service.cancelUnpaid('o1', 'reason');
      expect(tx.coupon.update).not.toHaveBeenCalled();
    });

    it('rejects an illegal cancel transition', async () => {
      tx.order.findUniqueOrThrow.mockResolvedValue({ id: 'o1', status: 'COMPLETED', couponId: null });
      await expect(service.cancelUnpaid('o1', 'reason')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('expireUnpaid', () => {
    it('returns 0 without a transaction when nothing is stale', async () => {
      prisma.order.findMany.mockResolvedValue([]);
      const res = await service.expireUnpaid(30);
      expect(res).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('cancels the batch and releases each distinct coupon once', async () => {
      prisma.order.findMany.mockResolvedValue([
        { id: 'a', couponId: 'c1' },
        { id: 'b', couponId: 'c1' },
        { id: 'c', couponId: null },
      ]);
      tx.order.updateMany = jest.fn().mockResolvedValue({ count: 3 });
      const res = await service.expireUnpaid(30);
      expect(tx.order.updateMany).toHaveBeenCalled();
      expect(tx.orderItem.updateMany).toHaveBeenCalled();
      // c1 released once despite appearing twice; null skipped
      expect(tx.coupon.update).toHaveBeenCalledTimes(1);
      expect(res).toBe(3);
    });
  });
});
