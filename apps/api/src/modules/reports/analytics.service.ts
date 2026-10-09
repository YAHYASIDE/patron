import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DateRangeDto } from './dto/report.dto';

/**
 * Analytical reporting — trends, cohorts, comparisons.
 *
 * Separated from ReportsService because these answer a different question.
 * ReportsService answers "what happened"; this answers "is it getting better or
 * worse, and where should attention go".
 */
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Period-over-period movement. A number without its previous value is
   * decoration; the delta is the reason anyone opens the dashboard.
   */
  async trends(dto: DateRangeDto) {
    const { from, to } = dto.resolve();
    const span = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - span);

    const [current, previous] = await Promise.all([
      this.periodTotals(from, to),
      this.periodTotals(prevFrom, from),
    ]);

    const delta = (now: number, before: number) =>
      before === 0 ? (now === 0 ? 0 : 100) : Number((((now - before) / before) * 100).toFixed(2));

    return {
      range: { from, to },
      comparedTo: { from: prevFrom, to: from },
      current,
      previous,
      change: {
        revenuePercent: delta(current.revenue, previous.revenue),
        ordersPercent: delta(current.orders, previous.orders),
        profitPercent: delta(current.profit, previous.profit),
        aovPercent: delta(current.aov, previous.aov),
        failureRatePoints: Number((current.failureRate - previous.failureRate).toFixed(2)),
      },
    };
  }

  private async periodTotals(from: Date, to: Date) {
    const [row] = await this.prisma.$queryRaw<
      Array<{ revenue: string; cost: string; orders: bigint; aov: string; failure_rate: string }>
    >`
      SELECT COALESCE(SUM(o."totalBase"), 0)::text AS revenue,
             COALESCE(SUM(i."unitCost" * i."quantity"), 0)::text AS cost,
             COUNT(DISTINCT o."id") AS orders,
             COALESCE(AVG(o."totalBase"), 0)::text AS aov,
             COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE i."status" = 'FAILED')
                       / NULLIF(COUNT(i.*), 0), 2), 0)::text AS failure_rate
      FROM "orders" o
      LEFT JOIN "order_items" i ON i."orderId" = o."id"
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to}
    `;

    const revenue = Number(row.revenue);
    const cost = Number(row.cost);
    return {
      revenue,
      cost,
      profit: revenue - cost,
      marginPercent: revenue > 0 ? Number((((revenue - cost) / revenue) * 100).toFixed(2)) : 0,
      orders: Number(row.orders),
      aov: Number(row.aov),
      failureRate: Number(row.failure_rate),
    };
  }

  /**
   * Side-by-side provider comparison. The decision this supports is "should we
   * reorder priority, or renegotiate" — so it pairs cost against reliability
   * rather than showing either alone. The cheapest provider is not cheaper if
   * one order in twenty fails and lands in support.
   */
  async providerComparison(dto: DateRangeDto) {
    const { from, to } = dto.resolve();

    const rows = await this.prisma.$queryRaw<
      Array<{
        provider: string; priority: number; delivered: bigint; failed: bigint;
        success_rate: string; avg_cost: string; p95_ms: number; avg_delivery_seconds: number;
        is_healthy: boolean; balance: string;
      }>
    >`
      SELECT p."code" AS provider,
             p."priority",
             p."isHealthy" AS is_healthy,
             p."balance"::text,
             COUNT(*) FILTER (WHERE i."status" = 'DELIVERED') AS delivered,
             COUNT(*) FILTER (WHERE i."status" = 'FAILED') AS failed,
             COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE i."status" = 'DELIVERED')
                       / NULLIF(COUNT(i.*), 0), 2), 0)::text AS success_rate,
             COALESCE(AVG(i."unitCost"), 0)::text AS avg_cost,
             COALESCE((SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY c."durationMs")
                       FROM "provider_calls" c
                       WHERE c."providerId" = p."id" AND c."createdAt" BETWEEN ${from} AND ${to}), 0) AS p95_ms,
             COALESCE(AVG(EXTRACT(EPOCH FROM (i."deliveredAt" - o."paidAt"))), 0) AS avg_delivery_seconds
      FROM "providers" p
      LEFT JOIN "order_items" i ON i."fulfilledByProviderId" = p."id"
        AND i."createdAt" BETWEEN ${from} AND ${to}
      LEFT JOIN "orders" o ON o."id" = i."orderId"
      GROUP BY p."id", p."code", p."priority", p."isHealthy", p."balance"
      ORDER BY p."priority"
    `;

    return {
      range: { from, to },
      providers: rows.map((r) => ({
        ...r,
        delivered: Number(r.delivered),
        failed: Number(r.failed),
        /**
         * Effective cost loads the failure rate onto the unit cost: a provider
         * that is 2% cheaper but fails 5% of the time is more expensive once
         * refunds and support time are counted.
         */
        effectiveCost:
          Number(r.success_rate) > 0
            ? Number((Number(r.avg_cost) / (Number(r.success_rate) / 100)).toFixed(4))
            : null,
      })),
    };
  }

  /**
   * Customer lifetime value by signup cohort.
   *
   * Reported as realised spend, not a projection. A modelled LTV built on three
   * months of data is a number that invites bad decisions; this is what people
   * have actually spent, which is defensible.
   */
  async customerLifetimeValue(dto: DateRangeDto) {
    const { from, to } = dto.resolve();

    const cohorts = await this.prisma.$queryRaw<
      Array<{
        cohort: Date; customers: bigint; buyers: bigint; orders: bigint;
        revenue: string; ltv: string; repeat_rate: string;
      }>
    >`
      WITH cohort_users AS (
        SELECT u."id", date_trunc('month', u."createdAt") AS cohort
        FROM "users" u
        WHERE u."createdAt" BETWEEN ${from} AND ${to} AND u."deletedAt" IS NULL
      ),
      spend AS (
        SELECT cu.cohort, cu."id" AS user_id,
               COUNT(o.*) AS order_count,
               COALESCE(SUM(o."totalBase"), 0) AS revenue
        FROM cohort_users cu
        LEFT JOIN "orders" o ON o."userId" = cu."id" AND o."paidAt" IS NOT NULL
        GROUP BY cu.cohort, cu."id"
      )
      SELECT cohort,
             COUNT(*) AS customers,
             COUNT(*) FILTER (WHERE order_count > 0) AS buyers,
             SUM(order_count) AS orders,
             SUM(revenue)::text AS revenue,
             ROUND(AVG(revenue), 2)::text AS ltv,
             COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE order_count > 1)
                       / NULLIF(COUNT(*) FILTER (WHERE order_count > 0), 0), 2), 0)::text AS repeat_rate
      FROM spend
      GROUP BY cohort ORDER BY cohort
    `;

    const segments = await this.prisma.$queryRaw<
      Array<{ segment: string; customers: bigint; revenue: string; avg_ltv: string }>
    >`
      WITH totals AS (
        SELECT "userId", SUM("totalBase") AS spend, COUNT(*) AS orders
        FROM "orders" WHERE "paidAt" IS NOT NULL GROUP BY "userId"
      )
      SELECT CASE
               WHEN spend >= 500 THEN 'vip'
               WHEN spend >= 100 THEN 'regular'
               WHEN orders > 1 THEN 'returning'
               ELSE 'one_time'
             END AS segment,
             COUNT(*) AS customers,
             SUM(spend)::text AS revenue,
             ROUND(AVG(spend), 2)::text AS avg_ltv
      FROM totals GROUP BY 1 ORDER BY SUM(spend) DESC
    `;

    return { range: { from, to }, cohorts, segments };
  }

  /**
   * Failed order analytics — built to answer "what do we fix first".
   * Ordered by revenue lost, not by count: fifty failed $1 top-ups matter less
   * than five failed $200 licenses.
   */
  async failedOrders(dto: DateRangeDto) {
    const { from, to } = dto.resolve();

    const [byRevenueLost, byHour, recoveryRate] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ sku: string; name: string; failures: bigint; revenue_lost: string; top_error: string }>
      >`
        SELECT pr."sku", pr."nameEn" AS name,
               COUNT(*) AS failures,
               SUM(i."lineTotal" / o."fxRate")::text AS revenue_lost,
               MODE() WITHIN GROUP (ORDER BY i."lastError") AS top_error
        FROM "order_items" i
        JOIN "orders" o ON o."id" = i."orderId"
        JOIN "products" pr ON pr."id" = i."productId"
        WHERE i."status" = 'FAILED' AND i."createdAt" BETWEEN ${from} AND ${to}
        GROUP BY pr."sku", pr."nameEn"
        ORDER BY SUM(i."lineTotal" / o."fxRate") DESC
        LIMIT 25
      `,
      // Clustering by hour separates "a provider had a bad night" from
      // "this product is permanently broken".
      this.prisma.$queryRaw<Array<{ hour: Date; failures: bigint }>>`
        SELECT date_trunc('hour', i."createdAt") AS hour, COUNT(*) AS failures
        FROM "order_items" i
        WHERE i."status" = 'FAILED' AND i."createdAt" BETWEEN ${from} AND ${to}
        GROUP BY 1 ORDER BY 1
      `,
      this.prisma.$queryRaw<Array<{ attempted: bigint; recovered: string }>>`
        SELECT COUNT(*) AS attempted,
               COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE i."status" = 'DELIVERED')
                         / NULLIF(COUNT(*), 0), 2), 0)::text AS recovered
        FROM "order_items" i
        WHERE i."attemptCount" > 1 AND i."createdAt" BETWEEN ${from} AND ${to}
      `,
    ]);

    return { range: { from, to }, byRevenueLost, byHour, retryRecovery: recoveryRate[0] };
  }

  /** Profitability broken down by the dimension that explains it. */
  async profitability(dto: DateRangeDto) {
    const { from, to } = dto.resolve();

    const [byCategory, byCurrency, worstMargins] = await Promise.all([
      this.prisma.$queryRaw<Array<{ category: string; revenue: string; cost: string; margin_percent: string }>>`
        SELECT c."nameEn" AS category,
               SUM(i."lineTotal" / o."fxRate")::text AS revenue,
               SUM(i."unitCost" * i."quantity")::text AS cost,
               ROUND(100.0 * SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")
                       / NULLIF(SUM(i."lineTotal" / o."fxRate"), 0), 2)::text AS margin_percent
        FROM "order_items" i
        JOIN "orders" o ON o."id" = i."orderId"
        JOIN "products" pr ON pr."id" = i."productId"
        JOIN "categories" c ON c."id" = pr."categoryId"
        WHERE o."paidAt" BETWEEN ${from} AND ${to} AND i."status" = 'DELIVERED'
        GROUP BY c."nameEn" ORDER BY 2 DESC
      `,
      this.prisma.$queryRaw<Array<{ currency: string; revenue: string; margin_percent: string; avg_fx: string }>>`
        SELECT o."currency",
               SUM(i."lineTotal" / o."fxRate")::text AS revenue,
               ROUND(100.0 * SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")
                       / NULLIF(SUM(i."lineTotal" / o."fxRate"), 0), 2)::text AS margin_percent,
               ROUND(AVG(o."fxRate"), 6)::text AS avg_fx
        FROM "order_items" i
        JOIN "orders" o ON o."id" = i."orderId"
        WHERE o."paidAt" BETWEEN ${from} AND ${to} AND i."status" = 'DELIVERED'
        GROUP BY o."currency" ORDER BY 2 DESC
      `,
      // Products selling at or below cost — usually a stale manual price
      // override that never followed a provider cost increase.
      this.prisma.$queryRaw<Array<{ sku: string; margin_percent: string; units: bigint }>>`
        SELECT pr."sku",
               ROUND(100.0 * SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")
                       / NULLIF(SUM(i."lineTotal" / o."fxRate"), 0), 2)::text AS margin_percent,
               SUM(i."quantity") AS units
        FROM "order_items" i
        JOIN "orders" o ON o."id" = i."orderId"
        JOIN "products" pr ON pr."id" = i."productId"
        WHERE o."paidAt" BETWEEN ${from} AND ${to} AND i."status" = 'DELIVERED'
        GROUP BY pr."sku"
        HAVING SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity") <= 0
        ORDER BY 2 ASC LIMIT 25
      `,
    ]);

    return { range: { from, to }, byCategory, byCurrency, sellingAtALoss: worstMargins };
  }
}
