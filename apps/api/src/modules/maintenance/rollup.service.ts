import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Daily metric rollups.
 *
 * Reporting queries aggregate over `orders` joined to `order_items`. At a
 * million orders a 90-day revenue report reads several hundred thousand rows
 * every time someone opens the dashboard — and the dashboard is opened
 * constantly.
 *
 * Rolling up once per day turns those reports into a scan of a few hundred
 * pre-aggregated rows. Live tables are still used for anything inside today,
 * where accuracy matters more than cost.
 */
@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Recompute a day. Idempotent by upsert, so a re-run after a late refund or
   * a backfill produces the correct number rather than a doubled one.
   */
  async rollupDay(date: Date) {
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const next = new Date(day.getTime() + 864e5);

    const affected = await this.prisma.$executeRaw`
      INSERT INTO "daily_rollups" (
        "day", "currency", "orders", "paidOrders", "failedOrders",
        "itemsDelivered", "itemsFailed", "grossBase", "discountBase",
        "refundBase", "costBase", "newCustomers", "computedAt"
      )
      SELECT ${day}::date AS day,
             o."currency",
             COUNT(DISTINCT o."id"),
             COUNT(DISTINCT o."id") FILTER (WHERE o."paidAt" IS NOT NULL),
             COUNT(DISTINCT o."id") FILTER (WHERE o."status" IN ('FAILED', 'PARTIALLY_COMPLETED')),
             COUNT(i.*) FILTER (WHERE i."status" = 'DELIVERED'),
             COUNT(i.*) FILTER (WHERE i."status" = 'FAILED'),
             COALESCE(SUM(o."totalBase"), 0),
             COALESCE(SUM(o."discount" / o."fxRate"), 0),
             COALESCE((SELECT SUM(r."amountBase") FROM "refunds" r
                       WHERE r."status" = 'PROCESSED'
                         AND r."processedAt" >= ${day} AND r."processedAt" < ${next}), 0),
             COALESCE(SUM(i."unitCost" * i."quantity") FILTER (WHERE i."status" = 'DELIVERED'), 0),
             COALESCE((SELECT COUNT(*) FROM "users" u
                       WHERE u."createdAt" >= ${day} AND u."createdAt" < ${next}
                         AND u."deletedAt" IS NULL), 0),
             NOW()
      FROM "orders" o
      LEFT JOIN "order_items" i ON i."orderId" = o."id"
      WHERE o."paidAt" >= ${day} AND o."paidAt" < ${next}
      GROUP BY o."currency"
      ON CONFLICT ("day", "currency") DO UPDATE SET
        "orders" = EXCLUDED."orders",
        "paidOrders" = EXCLUDED."paidOrders",
        "failedOrders" = EXCLUDED."failedOrders",
        "itemsDelivered" = EXCLUDED."itemsDelivered",
        "itemsFailed" = EXCLUDED."itemsFailed",
        "grossBase" = EXCLUDED."grossBase",
        "discountBase" = EXCLUDED."discountBase",
        "refundBase" = EXCLUDED."refundBase",
        "costBase" = EXCLUDED."costBase",
        "newCustomers" = EXCLUDED."newCustomers",
        "computedAt" = NOW()
    `;

    this.logger.log(`Rolled up ${day.toISOString().slice(0, 10)}: ${affected} currency row(s)`);
    return affected;
  }

  /**
   * Nightly job. Recomputes yesterday *and* the two days before it: refunds
   * and late fulfilments change a day's numbers after midnight, and a rollup
   * that is only ever written once is a rollup that is quietly wrong.
   */
  async rollupRecent(days = 3) {
    let total = 0;
    for (let i = 1; i <= days; i++) {
      total += await this.rollupDay(new Date(Date.now() - i * 864e5));
    }
    return total;
  }

  /** Backfill after a restore or a first deploy. */
  async backfill(from: Date, to: Date) {
    let cursor = new Date(from);
    let days = 0;
    while (cursor < to) {
      await this.rollupDay(cursor);
      cursor = new Date(cursor.getTime() + 864e5);
      days++;
    }
    this.logger.log(`Backfilled ${days} day(s)`);
    return days;
  }

  /**
   * Pre-aggregated daily rows for a range. This is what the dashboard reads:
   * a few hundred rows instead of several hundred thousand.
   */
  series(from: Date, to: Date, currency?: string) {
    return this.prisma.dailyRollup.findMany({
      where: {
        day: { gte: from, lt: to },
        ...(currency ? { currency } : {}),
      },
      orderBy: { day: 'asc' },
    });
  }

  /**
   * When the rollup was last computed, so a dashboard can say "as of 01:15"
   * rather than quietly presenting figures that are a day behind.
   */
  async freshness(): Promise<Date | null> {
    const latest = await this.prisma.dailyRollup.findFirst({
      orderBy: { computedAt: 'desc' },
      select: { computedAt: true },
    });
    return latest?.computedAt ?? null;
  }
}
