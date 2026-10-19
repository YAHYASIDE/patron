import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_WATCHES, WatchesService, basePrice } from '../../src/modules/customer/watches.service';
import { inStockMap } from '../../src/modules/customer/stock';

const D = (v: string | number) => new Prisma.Decimal(v);
const PRODUCT = '22222222-2222-4222-8222-222222222222';

describe('basePrice', () => {
  it('applies the owner discount to the base sell price', () => {
    expect(basePrice({ sellPrice: D('10'), discountPercent: 15 }).toString()).toBe('8.5');
    expect(basePrice({ sellPrice: D('10'), discountPercent: null }).toString()).toBe('10');
  });
});

describe('inStockMap', () => {
  it('reads code stock, provider routes and stockQty like the public catalogue', async () => {
    const prisma: any = {
      productCode: { groupBy: jest.fn().mockResolvedValue([{ productId: 'c1', _count: { _all: 3 } }]) },
      productProvider: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const map = await inStockMap(prisma, [
      { id: 'c1', delivery: 'CODE_POOL', stockQty: null },
      { id: 'c2', delivery: 'CODE_POOL', stockQty: null },
      { id: 'a1', delivery: 'AUTO_PROVIDER', stockQty: null },
      { id: 'm1', delivery: 'MANUAL', stockQty: null },
      { id: 'm2', delivery: 'MANUAL', stockQty: 0 },
      { id: 'm3', delivery: 'MANUAL', stockQty: 4 },
    ] as any);
    expect(Object.fromEntries(map)).toEqual({ c1: true, c2: false, a1: false, m1: true, m2: false, m3: true });
    expect(prisma.productProvider.groupBy.mock.calls[0][0].where.provider).toEqual({ isActive: true, isHealthy: true });
  });

  it('counts a healthy route as stock and makes no query for an empty list', async () => {
    const prisma: any = {
      productCode: { groupBy: jest.fn() },
      productProvider: { groupBy: jest.fn().mockResolvedValue([{ productId: 'a1', _count: { _all: 1 } }]) },
    };
    expect((await inStockMap(prisma, [{ id: 'a1', delivery: 'AUTO_PROVIDER', stockQty: null }] as any)).get('a1')).toBe(true);
    expect((await inStockMap(prisma, [])).size).toBe(0);
    expect(prisma.productCode.groupBy).not.toHaveBeenCalled();
  });
});

describe('WatchesService', () => {
  let prisma: any;
  let tx: any;
  let notifications: any;
  let service: WatchesService;

  const product = { id: PRODUCT, sellPrice: D('10'), discountPercent: null, delivery: 'MANUAL', stockQty: 0 };

  beforeEach(() => {
    tx = { priceWatch: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    prisma = {
      product: { findFirst: jest.fn().mockResolvedValue(product) },
      priceWatch: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'w1' }),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn((a: any) => Promise.resolve({ id: 'w1', ...a.create })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      productCode: { groupBy: jest.fn().mockResolvedValue([]) },
      productProvider: { groupBy: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    notifications = { notify: jest.fn().mockResolvedValue({ id: 'n1' }) };
    service = new WatchesService(prisma, notifications);
  });

  it('lists the caller\'s watches with their product', async () => {
    await service.list('u1');
    const args = prisma.priceWatch.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.select.product.select).toEqual({ id: true, sku: true, nameAr: true, nameEn: true, gameId: true });
  });

  it('creates a price watch at today\'s base price', async () => {
    prisma.product.findFirst.mockResolvedValue({ ...product, discountPercent: 10 });
    await service.create('u1', { productId: PRODUCT, kind: 'price' });
    const args = prisma.priceWatch.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId_productId_kind: { userId: 'u1', productId: PRODUCT, kind: 'price' } });
    expect(args.create.priceAtWatch.toString()).toBe('9');
    expect(args.update).toEqual({ priceAtWatch: expect.anything(), notifiedAt: null });
  });

  it('returns an armed watch unchanged, and re-arms one that already fired', async () => {
    prisma.priceWatch.findUnique.mockResolvedValue({ id: 'w1', notifiedAt: null });
    await expect(service.create('u1', { productId: PRODUCT, kind: 'price' })).resolves.toEqual({ id: 'w1' });
    expect(prisma.priceWatch.upsert).not.toHaveBeenCalled();

    prisma.priceWatch.findUnique.mockResolvedValue({ id: 'w1', notifiedAt: new Date() });
    prisma.priceWatch.count.mockResolvedValue(MAX_WATCHES);
    await service.create('u1', { productId: PRODUCT, kind: 'price' });
    expect(prisma.priceWatch.upsert).toHaveBeenCalled();
  });

  it('refuses a hidden product, a stock alert on an in-stock product and too many alerts', async () => {
    prisma.product.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('u1', { productId: PRODUCT, kind: 'price' })).rejects.toThrow(NotFoundException);

    prisma.product.findFirst.mockResolvedValueOnce({ ...product, stockQty: null });
    await expect(service.create('u1', { productId: PRODUCT, kind: 'stock' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ error: 'ALREADY_IN_STOCK' }) });

    prisma.priceWatch.count.mockResolvedValue(MAX_WATCHES);
    await expect(service.create('u1', { productId: PRODUCT, kind: 'price' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ error: 'TOO_MANY_WATCHES' }) });
  });

  it('accepts a stock alert on a sold-out product', async () => {
    await service.create('u1', { productId: PRODUCT, kind: 'stock' });
    expect(prisma.priceWatch.upsert.mock.calls[0][0].create.kind).toBe('stock');
  });

  it('removes only the caller\'s watch', async () => {
    await expect(service.remove('u1', 'w1')).resolves.toEqual({ deleted: true });
    expect(prisma.priceWatch.deleteMany).toHaveBeenCalledWith({ where: { id: 'w1', userId: 'u1' } });
    prisma.priceWatch.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('u1', 'w2')).rejects.toThrow(NotFoundException);
  });

  describe('runChecks', () => {
    const item = (over: any = {}, productOver: any = {}) => ({
      id: 'w1', userId: 'u1', kind: 'price', priceAtWatch: D('10'),
      product: {
        id: 'p1', sku: 'GC APPLE', nameAr: 'آبل', nameEn: 'Apple',
        sellPrice: D('10'), discountPercent: null, delivery: 'MANUAL', stockQty: null, ...productOver,
      },
      ...over,
    });

    it('does nothing without armed watches', async () => {
      await expect(service.runChecks()).resolves.toEqual({ checked: 0, notified: 0 });
      expect(prisma.priceWatch.findMany.mock.calls[0][0].where).toEqual({
        notifiedAt: null, product: { deletedAt: null, isActive: true },
      });
    });

    it('notifies a price drop and a product back in stock, and skips the rest', async () => {
      prisma.priceWatch.findMany.mockResolvedValue([
        item({ id: 'drop' }, { discountPercent: 20 }),
        item({ id: 'same' }),
        item({ id: 'back', kind: 'stock', userId: 'u2' }, { id: 'p2', stockQty: 3 }),
        item({ id: 'still-out', kind: 'stock' }, { id: 'p3', stockQty: 0 }),
      ]);

      await expect(service.runChecks()).resolves.toEqual({ checked: 4, notified: 2 });

      expect(tx.priceWatch.updateMany).toHaveBeenCalledWith({ where: { id: 'drop', notifiedAt: null }, data: { notifiedAt: expect.any(Date) } });
      const [price, priceTx] = notifications.notify.mock.calls[0];
      expect(priceTx).toBe(tx);
      expect(price).toMatchObject({ userId: 'u1', type: 'watch.price', productId: 'p1', link: '/products/GC%20APPLE' });
      expect(price.fr.title).toBe('Baisse de prix');
      const [stock] = notifications.notify.mock.calls[1];
      expect(stock).toMatchObject({ userId: 'u2', type: 'watch.stock', productId: 'p2' });
      expect(stock.ar.body).toContain('آبل');
    });

    it('does not notify a watch another run already claimed', async () => {
      prisma.priceWatch.findMany.mockResolvedValue([item({}, { sellPrice: D('5') })]);
      tx.priceWatch.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.runChecks()).resolves.toEqual({ checked: 1, notified: 0 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('keeps going when one watch fails', async () => {
      prisma.priceWatch.findMany.mockResolvedValue([
        item({ id: 'a' }, { sellPrice: D('5') }),
        item({ id: 'b' }, { sellPrice: D('5') }),
      ]);
      notifications.notify.mockRejectedValueOnce(new Error('db down'));
      await expect(service.runChecks()).resolves.toEqual({ checked: 2, notified: 1 });
    });
  });
});
