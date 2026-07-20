import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QUEUES } from '../queues/queue.constants';
import { DateRangeDto, Granularity } from './dto/report.dto';
import { RollupService } from '../maintenance/rollup.service';

/**
 * Reporting runs on raw SQL, not the ORM.
 *
 * Aggregations over hundreds of thousands of rows are the one place where
 * hand-written SQL is clearly correct: Prisma's groupBy cannot express window
 * functions or date bucketing, and pulling rows into Node to sum them is how a
 * report becomes a five-minute request.
 *
 * All money is reported in the **base currency**. Every order stores the FX rate
 * it was priced with, so `totalBase` is directly comparable across currencies —
 * summing mixed-currency `total` columns would be meaningless.
 */
@Injectable()
export class ReportsService {
  constructor(
    private prisma: PrismaService,
    private rollups: RollupService,
    @InjectQueue(QUEUES.FULFILMENT) private fulfilment: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) private notifications: Queue,
    @InjectQueue(QUEUES.MAINTENANCE) private maintenance: Queue,
  ) {}

  // resolve() throws BadRequestException itself; no wrapper needed.
  private range(dto: DateRangeDto) {
    return dto.resolve();
  }

  private bucket(granularity: Granularity) {
    // Whitelisted, never interpolated from user input directly.
    return { day: 'day', week: 'week', month: 'month' }[granularity] ?? 'day';
  }

  // ─────────────── Revenue ───────────────

  /**
   * Revenue.
   *
   * Reads the daily rollup for whole days that have already been computed, and
   * the live tables only for today. At 1M orders the live-table version read
   * several hundred thousand rows per dashboard load; this reads a few hundred
   * plus today's partial day. See ADR 017.
   */
  /**
   * Daily revenue is served from the pre-aggregated rollup — at 1M orders,
   * re-scanning the orders table on every dashboard load is a cost nobody
   * should pay repeatedly. Week and month granularity aggregate the rollup
   * rows, not the raw table.
   *
   * `freshness` is returned so a dashboard can say "as of 01:15" rather than
   * quietly showing figures that are a day behind.
   */
  async revenueFast(dto: DateRangeDto) {
    const { from, to } = this.range(dto);
    const rows = await this.rollups.series(from, to, dto.currency);

    const totals = rows.reduce(
      (acc, r) => ({
        orders: acc.orders + r.paidOrders,
        gross: acc.gross + Number(r.grossBase),
        refunds: acc.refunds + Number(r.refundBase),
        cost: acc.cost + Number(r.costBase),
        net: acc.net + Number(r.grossBase) - Number(r.refundBase),
      }),
      { orders: 0, gross: 0, refunds: 0, cost: 0, net: 0 },
    );

    return {
      range: { from, to },
      source: 'rollup' as const,
      freshness: await this.rollups.freshness(),
      totals: { ...totals, profit: totals.gross - totals.cost - totals.refunds },
      series: rows,
    };
  }

  /** Exact, live figures straight from the source tables. Slower by design. */
  async revenue(dto: DateRangeDto) {
    const { from, to } = this.range(dto);
    const bucket = this.bucket(dto.granularity);
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));

    // Entirely historic range: the rollup is authoritative and much cheaper.
    if (to <= today) return this.revenueFromRollup(from, to, bucket, dto);

    const series = await this.prisma.$queryRawUnsafe<
      Array<{ period: Date; orders: bigint; gross: string; discounts: string; refunds: string; net: string }>
    >(
      `
      WITH paid AS (
        SELECT date_trunc($3, o."paidAt") AS period,
               COUNT(*) AS orders,
               SUM(o."totalBase") AS gross,
               SUM(o."discount" / o."fxRate") AS discounts
        FROM "orders" o
        WHERE o."paidAt" BETWEEN $1 AND $2
          AND o."status" NOT IN ('CANCELLED', 'PENDING_PAYMENT')
        GROUP BY 1
      ),
      refunded AS (
        SELECT date_trunc($3, r."processedAt") AS period,
               SUM(r."amountBase") AS refunds
        FROM "refunds" r
        WHERE r."processedAt" BETWEEN $1 AND $2 AND r."status" = 'PROCESSED'
        GROUP BY 1
      )
      SELECT COALESCE(p.period, f.period) AS period,
             COALESCE(p.orders, 0) AS orders,
             COALESCE(p.gross, 0)::text AS gross,
             COALESCE(p.discounts, 0)::text AS discounts,
             COALESCE(f.refunds, 0)::text AS refunds,
             (COALESCE(p.gross, 0) - COALESCE(f.refunds, 0))::text AS net
      FROM paid p
      FULL OUTER JOIN refunded f ON p.period = f.period
      ORDER BY 1
      `,
      from, to, bucket,
    );

    const totals = series.reduce(
      (acc, row) => ({
        orders: acc.orders + Number(row.orders),
        gross: acc.gross + Number(row.gross),
        refunds: acc.refunds + Number(row.refunds),
        net: acc.net + Number(row.net),
      }),
      { orders: 0, gross: 0, refunds: 0, net: 0 },
    );

    return { range: { from, to }, granularity: dto.granularity, totals, series, source: 'live' as const };
  }

  private async revenueFromRollup(from: Date, to: Date, bucket: string, dto: DateRangeDto) {
    const series = await this.prisma.$queryRawUnsafe<
      Array<{ period: Date; orders: bigint; gross: string; refunds: string; net: string }>
    >(
      `
      SELECT date_trunc($3, "day")::timestamp AS period,
             SUM("paidOrders")::bigint AS orders,
             SUM("grossBase")::text AS gross,
             SUM("refundBase")::text AS refunds,
             (SUM("grossBase") - SUM("refundBase"))::text AS net
      FROM "daily_rollups"
      WHERE "day" >= $1::date AND "day" < $2::date
      GROUP BY 1 ORDER BY 1
      `,
      from, to, bucket,
    );

    const totals = series.reduce(
      (acc, row) => ({
        orders: acc.orders + Number(row.orders),
        gross: acc.gross + Number(row.gross),
        refunds: acc.refunds + Number(row.refunds),
        net: acc.net + Number(row.net),
      }),
      { orders: 0, gross: 0, refunds: 0, net: 0 },
    );

    return { range: { from, to }, granularity: dto.granularity, totals, series, source: 'rollup' as const };
  }

  // ─────────────── Profit ───────────────

  /**
   * Margin is knowable per order because provider cost was frozen at quote time.
   * Without that freeze this report would be an estimate against today's costs.
   */
  async profit(dto: DateRangeDto) {
    const { from, to } = this.range(dto);
    const bucket = this.bucket(dto.granularity);

    const series = await this.prisma.$queryRawUnsafe<
      Array<{ period: Date; revenue: string; cost: string; profit: string; margin_percent: string; items: bigint }>
    >(
      `
      SELECT date_trunc($3, o."paidAt") AS period,
             SUM(i."lineTotal" / o."fxRate")::text AS revenue,
             SUM(i."unitCost" * i."quantity")::text AS cost,
             SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")::text AS profit,
             CASE WHEN SUM(i."lineTotal" / o."fxRate") > 0
               THEN ROUND(100 * SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")
                            / SUM(i."lineTotal" / o."fxRate"), 2)::text
               ELSE '0' END AS margin_percent,
             COUNT(i.*) AS items
      FROM "orders" o
      JOIN "order_items" i ON i."orderId" = o."id"
      WHERE o."paidAt" BETWEEN $1 AND $2
        AND i."status" = 'DELIVERED'
      GROUP BY 1 ORDER BY 1
      `,
      from, to, bucket,
    );

    return { range: { from, to }, granularity: dto.granularity, series };
  }

  // ─────────────── Providers ───────────────

  providerPerformance(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    return this.prisma.$queryRaw<
      Array<{
        provider: string; calls: bigint; successes: bigint; failures: bigint;
        success_rate: string; p50_ms: number; p95_ms: number; p99_ms: number; timeouts: bigint;
      }>
    >`
      SELECT p."code" AS provider,
             COUNT(*) AS calls,
             COUNT(*) FILTER (WHERE c."success") AS successes,
             COUNT(*) FILTER (WHERE NOT c."success") AS failures,
             ROUND(100.0 * COUNT(*) FILTER (WHERE c."success") / NULLIF(COUNT(*), 0), 2)::text AS success_rate,
             PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY c."durationMs") AS p50_ms,
             PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY c."durationMs") AS p95_ms,
             PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY c."durationMs") AS p99_ms,
             COUNT(*) FILTER (WHERE c."errorCode" = 'transport_error') AS timeouts
      FROM "provider_calls" c
      JOIN "providers" p ON p."id" = c."providerId"
      WHERE c."createdAt" BETWEEN ${from} AND ${to}
      GROUP BY p."code"
      ORDER BY calls DESC
    `;
  }

  /** Which provider actually delivered, and what it cost us. */
  providerFulfilment(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    return this.prisma.$queryRaw<
      Array<{ provider: string; delivered: bigint; cost_base: string; avg_seconds: number }>
    >`
      SELECT COALESCE(p."code", 'unfulfilled') AS provider,
             COUNT(*) AS delivered,
             SUM(i."unitCost" * i."quantity")::text AS cost_base,
             AVG(EXTRACT(EPOCH FROM (i."deliveredAt" - o."paidAt"))) AS avg_seconds
      FROM "order_items" i
      JOIN "orders" o ON o."id" = i."orderId"
      LEFT JOIN "providers" p ON p."id" = i."fulfilledByProviderId"
      WHERE i."deliveredAt" BETWEEN ${from} AND ${to} AND i."status" = 'DELIVERED'
      GROUP BY 1 ORDER BY delivered DESC
    `;
  }

  // ─────────────── Products ───────────────

  productPerformance(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    return this.prisma.$queryRaw<
      Array<{
        sku: string; name: string; units: bigint; revenue_base: string;
        cost_base: string; profit_base: string; margin_percent: string; failure_rate: string;
      }>
    >`
      SELECT pr."sku",
             pr."nameEn" AS name,
             SUM(i."quantity") AS units,
             SUM(i."lineTotal" / o."fxRate")::text AS revenue_base,
             SUM(i."unitCost" * i."quantity")::text AS cost_base,
             SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")::text AS profit_base,
             ROUND(100.0 * SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")
                     / NULLIF(SUM(i."lineTotal" / o."fxRate"), 0), 2)::text AS margin_percent,
             ROUND(100.0 * COUNT(*) FILTER (WHERE i."status" = 'FAILED')
                     / NULLIF(COUNT(*), 0), 2)::text AS failure_rate
      FROM "order_items" i
      JOIN "orders" o ON o."id" = i."orderId"
      JOIN "products" pr ON pr."id" = i."productId"
      WHERE o."paidAt" BETWEEN ${from} AND ${to}
      GROUP BY pr."sku", pr."nameEn"
      ORDER BY revenue_base DESC
      LIMIT ${dto.limit}
    `;
    // NOTE: this is a $queryRaw tagged template — ${dto.limit} is bound as a
    // parameter, not interpolated. Do not convert this to $queryRawUnsafe.
  }

  // ─────────────── Customers ───────────────

  async customerStats(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    const [summary] = await this.prisma.$queryRaw<
      Array<{ new_customers: bigint; active_customers: bigint; repeat_customers: bigint; aov_base: string }>
    >`
      SELECT
        (SELECT COUNT(*) FROM "users" WHERE "createdAt" BETWEEN ${from} AND ${to} AND "deletedAt" IS NULL) AS new_customers,
        (SELECT COUNT(DISTINCT "userId") FROM "orders" WHERE "paidAt" BETWEEN ${from} AND ${to}) AS active_customers,
        (SELECT COUNT(*) FROM (
           SELECT "userId" FROM "orders"
           WHERE "paidAt" BETWEEN ${from} AND ${to}
           GROUP BY "userId" HAVING COUNT(*) > 1
         ) r) AS repeat_customers,
        (SELECT COALESCE(AVG("totalBase"), 0)::text FROM "orders" WHERE "paidAt" BETWEEN ${from} AND ${to}) AS aov_base
    `;

    const topCustomers = await this.prisma.$queryRaw<
      Array<{ userId: string; email: string; orders: bigint; spend_base: string }>
    >`
      SELECT u."id" AS "userId", u."email", COUNT(o.*) AS orders, SUM(o."totalBase")::text AS spend_base
      FROM "orders" o JOIN "users" u ON u."id" = o."userId"
      WHERE o."paidAt" BETWEEN ${from} AND ${to}
      GROUP BY u."id", u."email"
      ORDER BY SUM(o."totalBase") DESC
      LIMIT ${dto.limit}
    `;

    return { range: { from, to }, summary, topCustomers };
  }

  // ─────────────── Currency ───────────────

  currencyBreakdown(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    return this.prisma.$queryRaw<
      Array<{ currency: string; orders: bigint; gross_local: string; gross_base: string; avg_fx_rate: string }>
    >`
      SELECT o."currency",
             COUNT(*) AS orders,
             SUM(o."total")::text AS gross_local,
             SUM(o."totalBase")::text AS gross_base,
             ROUND(AVG(o."fxRate"), 6)::text AS avg_fx_rate
      FROM "orders" o
      WHERE o."paidAt" BETWEEN ${from} AND ${to}
      GROUP BY o."currency"
      ORDER BY SUM(o."totalBase") DESC
    `;
  }

  // ─────────────── Refunds ───────────────

  async refundReport(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    const [summary] = await this.prisma.$queryRaw<
      Array<{ total: bigint; processed: bigint; rejected: bigint; amount_base: string; refund_rate: string }>
    >`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE "status" = 'PROCESSED') AS processed,
             COUNT(*) FILTER (WHERE "status" = 'REJECTED') AS rejected,
             COALESCE(SUM("amountBase") FILTER (WHERE "status" = 'PROCESSED'), 0)::text AS amount_base,
             ROUND(100.0 * COALESCE(SUM("amountBase") FILTER (WHERE "status" = 'PROCESSED'), 0)
                     / NULLIF((SELECT SUM("totalBase") FROM "orders"
                               WHERE "paidAt" BETWEEN ${from} AND ${to}), 0), 2)::text AS refund_rate
      FROM "refunds"
      WHERE "createdAt" BETWEEN ${from} AND ${to}
    `;

    const byReason = await this.prisma.$queryRaw<Array<{ reason: string; count: bigint; amount_base: string }>>`
      SELECT LEFT("reason", 60) AS reason, COUNT(*) AS count, SUM("amountBase")::text AS amount_base
      FROM "refunds"
      WHERE "createdAt" BETWEEN ${from} AND ${to} AND "status" = 'PROCESSED'
      GROUP BY 1 ORDER BY count DESC LIMIT 20
    `;

    return { range: { from, to }, summary, byReason };
  }

  // ─────────────── Failure analysis ───────────────

  async failureAnalysis(dto: DateRangeDto) {
    const { from, to } = this.range(dto);

    const [byErrorCode, byProduct, stuck, outbox] = await Promise.all([
      this.prisma.$queryRaw<Array<{ error_code: string; provider: string; count: bigint }>>`
        SELECT c."errorCode" AS error_code, p."code" AS provider, COUNT(*) AS count
        FROM "provider_calls" c JOIN "providers" p ON p."id" = c."providerId"
        WHERE c."createdAt" BETWEEN ${from} AND ${to} AND NOT c."success"
        GROUP BY 1, 2 ORDER BY count DESC LIMIT 25
      `,
      this.prisma.$queryRaw<Array<{ sku: string; failures: bigint; attempts: bigint; failure_rate: string }>>`
        SELECT pr."sku",
               COUNT(*) FILTER (WHERE i."status" = 'FAILED') AS failures,
               COUNT(*) AS attempts,
               ROUND(100.0 * COUNT(*) FILTER (WHERE i."status" = 'FAILED') / NULLIF(COUNT(*), 0), 2)::text AS failure_rate
        FROM "order_items" i JOIN "products" pr ON pr."id" = i."productId"
        WHERE i."createdAt" BETWEEN ${from} AND ${to}
        GROUP BY pr."sku" HAVING COUNT(*) FILTER (WHERE i."status" = 'FAILED') > 0
        ORDER BY failures DESC LIMIT 25
      `,
      // Paid but undelivered for over an hour — the single most important
      // operational query in the system.
      this.prisma.$queryRaw<Array<{ orderId: string; orderNumber: string; minutes: number }>>`
        SELECT o."id" AS "orderId", o."orderNumber",
               EXTRACT(EPOCH FROM (NOW() - o."paidAt")) / 60 AS minutes
        FROM "orders" o
        WHERE o."status" IN ('PAID', 'PROCESSING')
          AND o."paidAt" < NOW() - INTERVAL '1 hour'
        ORDER BY o."paidAt" ASC LIMIT 100
      `,
      this.prisma.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    return { range: { from, to }, byErrorCode, byProduct, stuckOrders: stuck, outbox };
  }

  // ─────────────── Queues ───────────────

  async queueStats() {
    const queues = [
      { name: QUEUES.FULFILMENT, queue: this.fulfilment },
      { name: QUEUES.NOTIFICATIONS, queue: this.notifications },
      { name: QUEUES.MAINTENANCE, queue: this.maintenance },
    ];

    return Promise.all(
      queues.map(async ({ name, queue }) => ({
        name,
        counts: await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
        isPaused: await queue.isPaused(),
      })),
    );
  }

  /**
   * Operator dashboard.
   *
   * Reads pre-aggregated rows from `daily_rollups` rather than scanning the
   * orders table. The live figures — status breakdown and stuck orders — are
   * bounded by partial indexes, so they stay cheap regardless of table size.
   */
  async dashboard() {
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);

    const [rollup, liveStatuses, stuck, queues] = await Promise.all([
      this.prisma.dailyRollup.findMany({
        where: { day: { gte: weekAgo } },
        orderBy: { day: 'asc' },
      }),
      // Partial index on (status, createdAt): an index-only scan.
      this.prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: today } },
        _count: { _all: true },
      }),
      // The number an operator actually looks for during an incident.
      this.prisma.order.count({
        where: { status: { in: ['PAID', 'PROCESSING'] }, paidAt: { lt: new Date(Date.now() - 3_600_000) } },
      }),
      this.queueStats(),
    ]);

    const todayRow = rollup.filter((r) => r.day.getTime() === today.getTime());

    return {
      date: today,
      today: {
        orders: todayRow.reduce((a, r) => a + r.orders, 0),
        paidOrders: todayRow.reduce((a, r) => a + r.paidOrders, 0),
        revenueBase: todayRow.reduce((a, r) => a.plus(r.grossBase), new Prisma.Decimal(0)),
        // Profit is derived, not stored: gross − cost − refunds. Storing it
        // would be a fourth number that can disagree with the other three.
        profitBase: todayRow.reduce(
          (a, r) => a.plus(r.grossBase).minus(r.costBase).minus(r.refundBase),
          new Prisma.Decimal(0),
        ),
        failedItems: todayRow.reduce((a, r) => a + r.itemsFailed, 0),
      },
      lastSevenDays: rollup,
      ordersByStatus: liveStatuses,
      stuckOrders: stuck,
      queues,
      // Surfaced so nobody misreads a stale dashboard as a revenue collapse.
      rollupComputedAt: todayRow[0]?.computedAt ?? null,
    };
  }
}
