import { Prisma } from '@prisma/client';
import { InsightsService } from '../../src/modules/insights/insights.service';
import { InsightsController } from '../../src/modules/insights/insights.controller';
import { OverviewQueryDto } from '../../src/modules/insights/insights.dto';
import { PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('InsightsService', () => {
  let prisma: any;
  let fx: any;
  let service: InsightsService;

  const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
  const yesterday = new Date(today.getTime() - 86_400_000);

  /** $queryRaw is a tagged template: route each call by the SQL it carries. */
  const raw = (rows: { sales?: unknown[]; low?: unknown[]; locations?: unknown[] }) =>
    jest.fn((strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('LATERAL')) return Promise.resolve(rows.sales ?? []);
      if (sql.includes('product_codes')) return Promise.resolve(rows.low ?? []);
      return Promise.resolve(rows.locations ?? []);
    });

  beforeEach(() => {
    prisma = {
      $queryRaw: raw({}),
      order: { findFirst: jest.fn().mockResolvedValue(null) },
      payment: { count: jest.fn().mockResolvedValue(2) },
      verificationToken: { count: jest.fn().mockResolvedValue(3) },
      supportTicket: { count: jest.fn().mockResolvedValue(4) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
    };
    fx = { findStale: jest.fn().mockResolvedValue(['XOF']) };
    service = new InsightsService(prisma, fx);
  });

  describe('overview', () => {
    it('splits sales into today and yesterday with profit = revenue − cost', async () => {
      prisma.$queryRaw = raw({
        sales: [
          { day: today, orders: 3, revenue: '30.5', cost: '20.25' },
          { day: yesterday, orders: 1, revenue: '10', cost: '12' },
        ],
      });
      const res = await service.overview(new OverviewQueryDto());
      expect(res.today).toEqual({ revenue: '30.50', cost: '20.25', profit: '10.25', orders: 3 });
      expect(res.yesterday).toEqual({ revenue: '10.00', cost: '12.00', profit: '-2.00', orders: 1 });
      expect(res).toMatchObject({ pendingTransfers: 2, pendingVerifications: 3, openTickets: 4, staleFx: ['XOF'] });
    });

    it('reports zeros for a day without sales', async () => {
      const res = await service.overview(new OverviewQueryDto());
      expect(res.today).toEqual({ revenue: '0.00', cost: '0.00', profit: '0.00', orders: 0 });
      expect(res.yesterday.orders).toBe(0);
    });

    it('counts the same waiting rows as the dashboard pages', async () => {
      await service.overview(new OverviewQueryDto());
      expect(prisma.payment.count).toHaveBeenCalledWith({ where: { gateway: 'MANUAL', status: 'AUTHORIZED' } });
      const vt = prisma.verificationToken.count.mock.calls[0][0].where;
      expect(vt).toMatchObject({ codeEnc: { not: null }, consumedAt: null, user: { deletedAt: null } });
      expect(vt.expiresAt.gt).toBeInstanceOf(Date);
      expect(prisma.supportTicket.count).toHaveBeenCalledWith({ where: { status: 'OPEN' } });
    });

    it('binds the low-stock threshold and passes the rows through', async () => {
      const low = [{ productId: 'p1', sku: 'GC-1', nameAr: 'بطاقة', available: 1 }];
      prisma.$queryRaw = raw({ low });
      const res = await service.overview(Object.assign(new OverviewQueryDto(), { lowStock: 7 }));
      expect(res.lowStock).toBe(low);
      const call = prisma.$queryRaw.mock.calls.find((c: any[]) => c[0].join('?').includes('product_codes'));
      expect(call.slice(1)).toEqual([7]);
    });

    it('flags products under the target margin or below cost, after the discount, worst first', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'ok', sku: 'OK', nameAr: 'جيد', sellPrice: D(10), costPrice: D(8), discountPercent: null }, // 20%
        { id: 'thin', sku: 'THIN', nameAr: 'هامش', sellPrice: D(10), costPrice: D(9.7), discountPercent: null }, // 3%
        { id: 'loss', sku: 'LOSS', nameAr: 'خسارة', sellPrice: D(10), costPrice: D(9), discountPercent: 20 }, // 8 < 9
        { id: 'zero', sku: 'ZERO', nameAr: 'صفر', sellPrice: D(0), costPrice: D(1), discountPercent: null },
        { id: 'free', sku: 'FREE', nameAr: 'مجاني', sellPrice: D(0), costPrice: D(0), discountPercent: null },
      ]);
      const res = await service.overview(new OverviewQueryDto());
      expect(res.marginAlerts.map((a) => a.productId)).toEqual(['zero', 'loss', 'free', 'thin']);
      expect(res.marginAlerts[1]).toEqual({
        productId: 'loss', sku: 'LOSS', nameAr: 'خسارة', sellPrice: '8', costPrice: '9', discountPercent: 20, marginPercent: -12.5,
      });
      expect(res.marginAlerts[0].marginPercent).toBe(-100);
      expect(res.marginAlerts[3].marginPercent).toBe(3);
      expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, isActive: true });
    });

    it('uses the target margin from the query', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p', sku: 'P', nameAr: 'م', sellPrice: D(10), costPrice: D(8), discountPercent: null }, // 20%
      ]);
      expect((await service.overview(Object.assign(new OverviewQueryDto(), { margin: 25 }))).marginAlerts).toHaveLength(1);
      expect((await service.overview(Object.assign(new OverviewQueryDto(), { margin: 20 }))).marginAlerts).toHaveLength(0);
    });
  });

  describe('pulse', () => {
    it('returns the latest order and the waiting counts', async () => {
      const at = new Date('2026-10-19T10:00:00Z');
      prisma.order.findFirst.mockResolvedValue({ id: 'o9', orderNumber: 'PTN-9', createdAt: at });
      expect(await service.pulse()).toEqual({
        latestOrderId: 'o9', latestOrderNumber: 'PTN-9', latestOrderAt: at,
        pendingTransfers: 2, pendingVerifications: 3, openTickets: 4,
      });
      expect(prisma.order.findFirst.mock.calls[0][0].orderBy[0]).toEqual({ createdAt: 'desc' });
    });

    it('returns nulls before the first order', async () => {
      expect(await service.pulse()).toMatchObject({ latestOrderId: null, latestOrderNumber: null, latestOrderAt: null });
    });
  });

  describe('locations', () => {
    it('formats revenue as a 2-decimal string', async () => {
      prisma.$queryRaw = raw({
        locations: [
          { country: 'MR', city: 'Nouakchott', customers: 5, orders: 7, revenue: '123.4567' },
          { country: null, city: null, customers: 2, orders: 0, revenue: '0' },
        ],
      });
      expect(await service.locations()).toEqual([
        { country: 'MR', city: 'Nouakchott', customers: 5, orders: 7, revenue: '123.46' },
        { country: null, city: null, customers: 2, orders: 0, revenue: '0.00' },
      ]);
      const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
      expect(sql).toContain("r.\"name\" = 'customer'");
      expect(sql).toContain('"deletedAt" IS NULL');
    });
  });
});

describe('InsightsController', () => {
  it('delegates each route to the service', () => {
    const insights: any = { overview: jest.fn(() => 'o'), pulse: jest.fn(() => 'p'), locations: jest.fn(() => 'l') };
    const controller = new InsightsController(insights);
    const q = new OverviewQueryDto();
    expect(controller.overview(q)).toBe('o');
    expect(insights.overview).toHaveBeenCalledWith(q);
    expect(controller.pulse()).toBe('p');
    expect(controller.locations()).toBe('l');
  });

  it('guards each route with the contract permission', () => {
    const perms = (m: 'overview' | 'pulse' | 'locations') =>
      Reflect.getMetadata(PERMISSIONS_KEY, InsightsController.prototype[m]);
    expect(perms('overview')).toEqual(['reports.read']);
    expect(perms('pulse')).toEqual(['orders.read']);
    expect(perms('locations')).toEqual(['users.read']);
  });
});
