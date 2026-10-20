import { ReportsService } from '../../src/modules/reports/reports.service';
import { DateRangeDto, Granularity } from '../../src/modules/reports/dto/report.dto';

/** Build a real DateRangeDto so `.resolve()` and its validation run for real. */
function dateRange(partial: Partial<DateRangeDto> = {}): DateRangeDto {
  return Object.assign(new DateRangeDto(), partial);
}

/** UTC midnight of the current day, matching the service's `today` computation. */
function todayMidnight(): Date {
  return new Date(new Date().setUTCHours(0, 0, 0, 0));
}

describe('ReportsService', () => {
  let prisma: any;
  let rollups: any;
  let fulfilment: any;
  let notifications: any;
  let maintenance: any;
  let service: ReportsService;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      $queryRawUnsafe: jest.fn(),
      outboxEvent: { groupBy: jest.fn() },
      dailyRollup: { findMany: jest.fn() },
      order: { groupBy: jest.fn(), count: jest.fn() },
    };
    rollups = {
      series: jest.fn(),
      freshness: jest.fn(),
    };
    const queue = () => ({
      getJobCounts: jest.fn().mockResolvedValue({ waiting: 1, active: 2 }),
      isPaused: jest.fn().mockResolvedValue(false),
    });
    fulfilment = queue();
    notifications = queue();
    maintenance = queue();
    service = new ReportsService(prisma, rollups, fulfilment, notifications, maintenance);
  });

  describe('revenueFast', () => {
    it('sums rollup rows into scalar totals and reports rollup source + freshness', async () => {
      const freshAt = new Date('2026-07-22T01:15:00.000Z');
      const rows = [
        { day: new Date('2026-07-01'), paidOrders: 3, grossBase: '100', refundBase: '10', costBase: '40' },
        { day: new Date('2026-07-02'), paidOrders: 2, grossBase: '50', refundBase: '5', costBase: '20' },
      ];
      rollups.series.mockResolvedValue(rows);
      rollups.freshness.mockResolvedValue(freshAt);

      const dto = dateRange({ from: '2026-07-01', to: '2026-07-03', currency: 'USD' });
      const res = await service.revenueFast(dto);

      expect(rollups.series).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), 'USD');
      expect(res.source).toBe('rollup');
      expect(res.freshness).toBe(freshAt);
      expect(res.series).toBe(rows);
      expect(res.totals.orders).toBe(5);
      expect(res.totals.gross).toBe(150);
      expect(res.totals.refunds).toBe(15);
      expect(res.totals.cost).toBe(60);
      expect(res.totals.net).toBe(150 - 15);
      // profit = gross - cost - refunds
      expect(res.totals.profit).toBe(150 - 60 - 15);
    });

    it('yields zeroed totals when there are no rollup rows', async () => {
      rollups.series.mockResolvedValue([]);
      rollups.freshness.mockResolvedValue(null);

      const res = await service.revenueFast(dateRange({ from: '2026-07-01', to: '2026-07-03' }));

      expect(res.totals).toEqual({ orders: 0, gross: 0, refunds: 0, cost: 0, net: 0, profit: 0 });
      expect(res.freshness).toBeNull();
    });
  });

  describe('revenue (live)', () => {
    it('reads the live tables when the range extends past today', async () => {
      const series = [
        { period: new Date('2026-07-22'), orders: 4n, gross: '200', discounts: '5', refunds: '20', net: '180' },
        { period: new Date('2026-07-23'), orders: 1n, gross: '30', discounts: '0', refunds: '0', net: '30' },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(series);

      // No explicit `to` -> resolves to now, which is > today midnight -> live path.
      const dto = dateRange({ granularity: Granularity.WEEK });
      const res = await service.revenue(dto);

      expect(res.source).toBe('live');
      expect(res.granularity).toBe(Granularity.WEEK);
      expect(res.series).toBe(series);
      expect(res.totals).toEqual({ orders: 5, gross: 230, refunds: 20, net: 210 });
      // bucket whitelisting: week granularity maps to 'week' as the 3rd bind param.
      expect(prisma.$queryRawUnsafe.mock.calls[0][3]).toBe('week');
    });

    it('falls back to `day` bucket for an unrecognised granularity', async () => {
      prisma.$queryRawUnsafe.mockResolvedValue([]);
      const dto = dateRange({ granularity: 'quarter' as any });

      await service.revenue(dto);

      expect(prisma.$queryRawUnsafe.mock.calls[0][3]).toBe('day');
    });
  });

  describe('revenue (historic -> rollup)', () => {
    it('serves an entirely-past range from the rollup table', async () => {
      const series = [
        { period: new Date('2025-01-01'), orders: 10n, gross: '500', refunds: '50', net: '450' },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(series);

      const dto = dateRange({ from: '2025-01-01', to: '2025-01-10' });
      const res = await service.revenue(dto);

      expect(res.source).toBe('rollup');
      expect(res.totals).toEqual({ orders: 10, gross: 500, refunds: 50, net: 450 });
      // The rollup SQL selects from daily_rollups.
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('daily_rollups');
    });
  });

  describe('profit', () => {
    it('returns the raw margin series with the resolved range and granularity', async () => {
      const series = [
        { period: new Date('2026-07-01'), revenue: '100', cost: '60', profit: '40', margin_percent: '40.00', items: 5n },
      ];
      prisma.$queryRawUnsafe.mockResolvedValue(series);

      const dto = dateRange({ from: '2026-07-01', to: '2026-07-10', granularity: Granularity.MONTH });
      const res = await service.profit(dto);

      expect(res.series).toBe(series);
      expect(res.granularity).toBe(Granularity.MONTH);
      expect(prisma.$queryRawUnsafe.mock.calls[0][3]).toBe('month');
      expect(res.range.from).toBeInstanceOf(Date);
    });
  });

  describe('simple $queryRaw passthroughs', () => {
    it('providerPerformance returns the tagged-template result', async () => {
      const rows = [{ provider: 'acme', calls: 10n }];
      prisma.$queryRaw.mockResolvedValue(rows);
      await expect(service.providerPerformance(dateRange())).resolves.toBe(rows);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('providerFulfilment returns the tagged-template result', async () => {
      const rows = [{ provider: 'acme', delivered: 5n }];
      prisma.$queryRaw.mockResolvedValue(rows);
      await expect(service.providerFulfilment(dateRange())).resolves.toBe(rows);
    });

    it('productPerformance returns the tagged-template result', async () => {
      const rows = [{ sku: 'A', units: 3n }];
      prisma.$queryRaw.mockResolvedValue(rows);
      await expect(service.productPerformance(dateRange({ limit: 5 }))).resolves.toBe(rows);
    });

    it('currencyBreakdown returns the tagged-template result', async () => {
      const rows = [{ currency: 'USD', orders: 9n }];
      prisma.$queryRaw.mockResolvedValue(rows);
      await expect(service.currencyBreakdown(dateRange())).resolves.toBe(rows);
    });
  });

  describe('customerStats', () => {
    it('destructures the summary row and returns the top-customer list', async () => {
      const summary = { new_customers: 5n, active_customers: 3n, repeat_customers: 1n, aov_base: '42.00' };
      const top = [{ userId: 'u1', email: 'a@b.c', orders: 4n, spend_base: '400' }];
      prisma.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce(top);

      const res = await service.customerStats(dateRange({ limit: 10 }));

      expect(res.summary).toBe(summary);
      expect(res.topCustomers).toBe(top);
      expect(res.range.from).toBeInstanceOf(Date);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('refundReport', () => {
    it('returns the summary row and the by-reason breakdown', async () => {
      const summary = { total: 10n, processed: 8n, rejected: 2n, amount_base: '300', refund_rate: '5.00' };
      const byReason = [{ reason: 'fraud', count: 3n, amount_base: '100' }];
      prisma.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce(byReason);

      const res = await service.refundReport(dateRange());

      expect(res.summary).toBe(summary);
      expect(res.byReason).toBe(byReason);
    });
  });

  describe('failureAnalysis', () => {
    it('runs the four sources in parallel and shapes the result', async () => {
      const byErrorCode = [{ error_code: 'x', provider: 'acme', count: 4n }];
      const byProduct = [{ sku: 'A', failures: 2n, attempts: 10n, failure_rate: '20.00' }];
      const stuck = [{ orderId: 'o1', orderNumber: 'PN-1', minutes: 90 }];
      const outbox = [{ status: 'PENDING', _count: { _all: 3 } }];
      prisma.$queryRaw
        .mockResolvedValueOnce(byErrorCode)
        .mockResolvedValueOnce(byProduct)
        .mockResolvedValueOnce(stuck);
      prisma.outboxEvent.groupBy.mockResolvedValue(outbox);

      const res = await service.failureAnalysis(dateRange());

      expect(res.byErrorCode).toBe(byErrorCode);
      expect(res.byProduct).toBe(byProduct);
      expect(res.stuckOrders).toBe(stuck);
      expect(res.outbox).toBe(outbox);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
      expect(prisma.outboxEvent.groupBy).toHaveBeenCalledWith({ by: ['status'], _count: { _all: true } });
    });
  });

  describe('queueStats', () => {
    it('collects counts and pause state for all three queues', async () => {
      maintenance.isPaused.mockResolvedValue(true);

      const res = await service.queueStats();

      expect(res).toHaveLength(3);
      expect(res.map((q) => q.name)).toEqual(['fulfilment', 'notifications', 'maintenance']);
      expect(res[0].counts).toEqual({ waiting: 1, active: 2 });
      expect(res[0].isPaused).toBe(false);
      expect(res[2].isPaused).toBe(true);
      expect(fulfilment.getJobCounts).toHaveBeenCalledWith(
        'waiting', 'active', 'completed', 'failed', 'delayed', 'paused',
      );
    });
  });

  describe('dashboard', () => {
    it('aggregates today from the matching rollup rows and exposes live figures', async () => {
      const today = todayMidnight();
      const computedAt = new Date('2026-07-22T01:00:00.000Z');
      const rollup = [
        {
          day: today, orders: 4, paidOrders: 3, grossBase: 200, costBase: 80, refundBase: 10,
          itemsFailed: 1, computedAt,
        },
        {
          // A different currency row for the same day is aggregated together.
          day: today, orders: 2, paidOrders: 2, grossBase: 50, costBase: 20, refundBase: 5,
          itemsFailed: 0, computedAt,
        },
        {
          // An older day contributes to lastSevenDays but not to `today`.
          day: new Date(today.getTime() - 3 * 86_400_000), orders: 9, paidOrders: 9,
          grossBase: 900, costBase: 300, refundBase: 0, itemsFailed: 4, computedAt,
        },
      ];
      const liveStatuses = [{ status: 'PAID', _count: { _all: 2 } }];
      prisma.dailyRollup.findMany.mockResolvedValue(rollup);
      prisma.order.groupBy.mockResolvedValue(liveStatuses);
      prisma.order.count.mockResolvedValue(7);

      const res = await service.dashboard();

      expect(res.date.getTime()).toBe(today.getTime());
      expect(res.today.orders).toBe(6);
      expect(res.today.paidOrders).toBe(5);
      expect(res.today.revenueBase.toString()).toBe('250');
      // profit = gross - cost - refunds across the two today rows.
      expect(res.today.profitBase.toString()).toBe(String((200 - 80 - 10) + (50 - 20 - 5)));
      expect(res.today.failedItems).toBe(1);
      expect(res.lastSevenDays).toBe(rollup);
      expect(res.ordersByStatus).toBe(liveStatuses);
      expect(res.stuckOrders).toBe(7);
      expect(res.queues).toHaveLength(3);
      expect(res.rollupComputedAt).toBe(computedAt);
    });

    it('reports null freshness and zeroed today when no rollup exists for today', async () => {
      prisma.dailyRollup.findMany.mockResolvedValue([]);
      prisma.order.groupBy.mockResolvedValue([]);
      prisma.order.count.mockResolvedValue(0);

      const res = await service.dashboard();

      expect(res.today.orders).toBe(0);
      expect(res.today.revenueBase.toString()).toBe('0');
      expect(res.rollupComputedAt).toBeNull();
    });
  });
});
