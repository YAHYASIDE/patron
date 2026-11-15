import { AnalyticsService } from '../../src/modules/reports/analytics.service';
import { DateRangeDto } from '../../src/modules/reports/dto/report.dto';

function dateRange(partial: Partial<DateRangeDto> = {}): DateRangeDto {
  return Object.assign(new DateRangeDto(), partial);
}

/** A periodTotals raw row. */
function totalsRow(over: Partial<{ revenue: string; cost: string; orders: bigint; aov: string; failure_rate: string }> = {}) {
  return {
    revenue: '0', cost: '0', orders: 0n, aov: '0', failure_rate: '0', ...over,
  };
}

describe('AnalyticsService', () => {
  let prisma: any;
  let service: AnalyticsService;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn() };
    service = new AnalyticsService(prisma);
  });

  describe('trends', () => {
    it('computes period-over-period deltas and derived profit/margin', async () => {
      const current = totalsRow({ revenue: '200', cost: '80', orders: 10n, aov: '20', failure_rate: '5' });
      const previous = totalsRow({ revenue: '100', cost: '50', orders: 5n, aov: '20', failure_rate: '3' });
      prisma.$queryRaw.mockResolvedValueOnce([current]).mockResolvedValueOnce([previous]);

      const dto = dateRange({ from: '2026-06-01', to: '2026-07-01' });
      const res = await service.trends(dto);

      // comparedTo window is the equally-sized preceding span.
      expect(res.comparedTo.to.getTime()).toBe(res.range.from.getTime());
      expect(res.current.profit).toBe(120);
      expect(res.current.marginPercent).toBe(60);
      expect(res.previous.profit).toBe(50);
      // revenue 100 -> 200 = +100%
      expect(res.change.revenuePercent).toBe(100);
      // orders 5 -> 10 = +100%
      expect(res.change.ordersPercent).toBe(100);
      // profit 50 -> 120 = +140%
      expect(res.change.profitPercent).toBe(140);
      // aov unchanged
      expect(res.change.aovPercent).toBe(0);
      // failure rate expressed as point difference (5 - 3)
      expect(res.change.failureRatePoints).toBe(2);
    });

    it('handles a zero previous baseline: growth from nothing is 100%, flat-zero is 0%', async () => {
      const current = totalsRow({ revenue: '50', orders: 3n, aov: '16.67' });
      const previous = totalsRow(); // all zeros
      prisma.$queryRaw.mockResolvedValueOnce([current]).mockResolvedValueOnce([previous]);

      const res = await service.trends(dateRange());

      // revenue 0 -> 50 : before === 0 && now !== 0 -> 100
      expect(res.change.revenuePercent).toBe(100);
      // aov 0 -> 16.67 -> 100
      expect(res.change.aovPercent).toBe(100);
      // orders 0 -> 3 -> 100
      expect(res.change.ordersPercent).toBe(100);
      // both zero for margin baseline -> marginPercent 0 (revenue > 0 false)
      expect(res.previous.marginPercent).toBe(0);
    });

    it('treats a flat zero-to-zero metric as no change (0%)', async () => {
      const zero = totalsRow();
      prisma.$queryRaw.mockResolvedValueOnce([zero]).mockResolvedValueOnce([zero]);

      const res = await service.trends(dateRange());

      expect(res.change.revenuePercent).toBe(0);
      expect(res.change.ordersPercent).toBe(0);
      expect(res.change.profitPercent).toBe(0);
    });
  });

  describe('providerComparison', () => {
    it('loads the failure rate onto effective cost and coerces bigints', async () => {
      const rows = [
        {
          provider: 'acme', priority: 1, delivered: 95n, failed: 5n, success_rate: '95.00',
          avg_cost: '1.00', p95_ms: 120, avg_delivery_seconds: 4, is_healthy: true, balance: '500',
        },
        {
          // success_rate 0 -> effectiveCost null (avoids divide-by-zero).
          provider: 'dud', priority: 2, delivered: 0n, failed: 3n, success_rate: '0',
          avg_cost: '2.00', p95_ms: 0, avg_delivery_seconds: 0, is_healthy: false, balance: '0',
        },
      ];
      prisma.$queryRaw.mockResolvedValue(rows);

      const res = await service.providerComparison(dateRange());

      expect(res.providers[0].delivered).toBe(95);
      expect(res.providers[0].failed).toBe(5);
      // 1.00 / (95/100) = 1.0526...
      expect(res.providers[0].effectiveCost).toBeCloseTo(1.0526, 4);
      expect(res.providers[1].effectiveCost).toBeNull();
    });

    it('returns an empty provider list when nothing matched', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const res = await service.providerComparison(dateRange());
      expect(res.providers).toEqual([]);
      expect(res.range.from).toBeInstanceOf(Date);
    });
  });

  describe('customerLifetimeValue', () => {
    it('returns both the cohort table and the spend segments', async () => {
      const cohorts = [{ cohort: new Date('2026-01-01'), customers: 10n, buyers: 6n, orders: 12n, revenue: '900', ltv: '90', repeat_rate: '33.33' }];
      const segments = [{ segment: 'vip', customers: 2n, revenue: '1200', avg_ltv: '600' }];
      prisma.$queryRaw.mockResolvedValueOnce(cohorts).mockResolvedValueOnce(segments);

      const res = await service.customerLifetimeValue(dateRange());

      expect(res.cohorts).toBe(cohorts);
      expect(res.segments).toBe(segments);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('failedOrders', () => {
    it('runs the three sources in parallel and returns the single recovery row', async () => {
      const byRevenueLost = [{ sku: 'X', name: 'X', failures: 4n, revenue_lost: '800', top_error: 'timeout' }];
      const byHour = [{ hour: new Date('2026-07-01T03:00:00Z'), failures: 2n }];
      const recovery = [{ attempted: 10n, recovered: '40.00' }];
      prisma.$queryRaw
        .mockResolvedValueOnce(byRevenueLost)
        .mockResolvedValueOnce(byHour)
        .mockResolvedValueOnce(recovery);

      const res = await service.failedOrders(dateRange());

      expect(res.byRevenueLost).toBe(byRevenueLost);
      expect(res.byHour).toBe(byHour);
      expect(res.retryRecovery).toBe(recovery[0]);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
    });

    it('yields undefined retryRecovery when the recovery query is empty', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const res = await service.failedOrders(dateRange());

      expect(res.retryRecovery).toBeUndefined();
    });
  });

  describe('profitability', () => {
    it('returns category, currency and loss-making breakdowns', async () => {
      const byCategory = [{ category: 'Games', revenue: '500', cost: '200', margin_percent: '60.00' }];
      const byCurrency = [{ currency: 'USD', revenue: '500', margin_percent: '60.00', avg_fx: '1.000000' }];
      const worstMargins = [{ sku: 'LOSS', margin_percent: '-5.00', units: 3n }];
      prisma.$queryRaw
        .mockResolvedValueOnce(byCategory)
        .mockResolvedValueOnce(byCurrency)
        .mockResolvedValueOnce(worstMargins);

      const res = await service.profitability(dateRange());

      expect(res.byCategory).toBe(byCategory);
      expect(res.byCurrency).toBe(byCurrency);
      expect(res.sellingAtALoss).toBe(worstMargins);
      expect(res.range.to).toBeInstanceOf(Date);
    });
  });
});
