import { Prisma } from '@prisma/client';
import { StoreFactsService } from '../../src/modules/customer/store-facts.service';

describe('StoreFactsService', () => {
  let prisma: any;
  let config: any;
  let service: StoreFactsService;

  beforeEach(() => {
    prisma = {
      orderItem: {
        groupBy: jest.fn().mockResolvedValue([
          { productId: 'p1', _sum: { quantity: 9 } },
          { productId: 'hidden', _sum: { quantity: 5 } },
          { productId: 'p2', _sum: { quantity: null } },
        ]),
      },
      product: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'p2', sku: 'GC-APPLE-US-10', gameId: null },
          { id: 'p1', sku: 'PUBG-60', gameId: 'g1' },
        ]),
      },
      order: { count: jest.fn().mockResolvedValue(120) },
      user: { count: jest.fn().mockResolvedValue(45) },
      fxRate: {
        findMany: jest.fn().mockResolvedValue([
          { quoteCurrency: 'EUR', rate: new Prisma.Decimal('0.92') },
          { quoteCurrency: 'MRU', rate: new Prisma.Decimal('39.8') },
          { quoteCurrency: 'USD', rate: new Prisma.Decimal('1') },
        ]),
      },
    };
    config = { get: jest.fn().mockReturnValue(undefined) };
    service = new StoreFactsService(prisma, config);
  });

  it('ranks delivered units of the last 30 days, skipping products no longer on sale', async () => {
    const rows = await service.bestSellers(8);

    expect(rows).toEqual([
      { productId: 'p1', sku: 'PUBG-60', gameId: 'g1', units: 9 },
      { productId: 'p2', sku: 'GC-APPLE-US-10', gameId: null, units: 0 },
    ]);
    const args = prisma.orderItem.groupBy.mock.calls[0][0];
    expect(args.where.status).toBe('DELIVERED');
    const since: Date = args.where.deliveredAt.gte;
    expect(Date.now() - since.getTime()).toBeGreaterThan(29 * 864e5);
    expect(args.orderBy).toEqual({ _sum: { quantity: 'desc' } });
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual(expect.objectContaining({ deletedAt: null, isActive: true }));
  });

  it('caches best sellers for ten minutes and honours the limit', async () => {
    await service.bestSellers(8);
    const one = await service.bestSellers(1);
    expect(one).toHaveLength(1);
    expect(await service.bestSellers(0.2)).toHaveLength(1);
    expect(prisma.orderItem.groupBy).toHaveBeenCalledTimes(1);
  });

  it('counts delivered orders and customer accounts, cached', async () => {
    await expect(service.stats()).resolves.toEqual({ ordersDelivered: 120, customers: 45 });
    await service.stats();
    expect(prisma.order.count).toHaveBeenCalledTimes(1);
    expect(prisma.order.count.mock.calls[0][0].where.status).toEqual({ in: ['COMPLETED', 'PARTIALLY_COMPLETED'] });
    expect(prisma.user.count.mock.calls[0][0].where).toEqual({ deletedAt: null, roles: { some: { role: { name: 'customer' } } } });
  });

  it('returns the latest live rate per currency from the base', async () => {
    const now = new Date('2026-10-19T00:00:00Z');
    await expect(service.rates(now)).resolves.toEqual({ base: 'USD', rates: { EUR: 0.92, MRU: 39.8 } });
    const args = prisma.fxRate.findMany.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ baseCurrency: 'USD', isActive: true, effectiveAt: { lte: now } }));
    expect(args.distinct).toEqual(['quoteCurrency']);
  });

  it('uses the configured base currency', async () => {
    config.get.mockReturnValue('EUR');
    prisma.fxRate.findMany.mockResolvedValue([]);
    await expect(service.rates()).resolves.toEqual({ base: 'EUR', rates: {} });
  });
});
