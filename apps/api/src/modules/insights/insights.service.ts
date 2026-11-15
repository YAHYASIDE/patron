import { Injectable } from '@nestjs/common';
import { PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { COUNTED_ITEM, NET_JOINS, NET_REVENUE, PAID_ORDER } from '../reports/sales-sql';
import { FxService } from '../fx/fx.service';
import { OverviewQueryDto } from './insights.dto';

const DAY_MS = 86_400_000;

/** One day's sales in the base currency. */
export interface DayFigures {
  revenue: string;
  cost: string;
  profit: string;
  orders: number;
}

/**
 * What the owner sees first on the dashboard: today against yesterday, what is
 * waiting for them, and what needs fixing (low code stock, thin margins, stale
 * rates). Every figure is in the base currency, the way ReportsService counts
 * it: an order's `totalBase` and each item's cost frozen at quote time.
 */
@Injectable()
export class InsightsService {
  constructor(
    private prisma: PrismaService,
    private fx: FxService,
  ) {}

  async overview(query: OverviewQueryDto) {
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0));
    const yesterday = new Date(today.getTime() - DAY_MS);

    const [days, waiting, lowStock, marginAlerts, staleFx] = await Promise.all([
      this.salesByDay(yesterday, today),
      this.waiting(),
      this.lowStock(query.lowStock),
      this.marginAlerts(query.margin),
      this.fx.findStale(),
    ]);

    return { ...days, ...waiting, lowStock, marginAlerts, staleFx };
  }

  /** Polled every 20 s by the open dashboard: a handful of indexed counts and one row. */
  async pulse() {
    const [latest, waiting] = await Promise.all([
      this.prisma.order.findFirst({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, orderNumber: true, createdAt: true },
      }),
      this.waiting(),
    ]);
    return {
      latestOrderId: latest?.id ?? null,
      latestOrderNumber: latest?.orderNumber ?? null,
      latestOrderAt: latest?.createdAt ?? null,
      ...waiting,
    };
  }

  /** Customers by country and city, with what they bought (base currency). */
  async locations() {
    const rows = await this.prisma.$queryRaw<
      Array<{ country: string | null; city: string | null; customers: number; orders: number; revenue: string }>
    >`
      SELECT u."country" AS country,
             NULLIF(INITCAP(BTRIM(u."city")), '') AS city,
             COUNT(DISTINCT u."id")::int AS customers,
             COUNT(o."id")::int AS orders,
             COALESCE(SUM(o."totalBase"), 0)::text AS revenue
      FROM "users" u
      LEFT JOIN "orders" o ON o."userId" = u."id"
        AND o."status" IN ('PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED')
      WHERE u."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."roleId"
          WHERE ur."userId" = u."id" AND r."name" = 'customer'
        )
      GROUP BY 1, 2
      ORDER BY customers DESC, SUM(o."totalBase") DESC NULLS LAST
      LIMIT 300
    `;
    return rows.map((r) => ({ ...r, revenue: new Prisma.Decimal(r.revenue).toFixed(2) }));
  }

  // ─────────────── parts ───────────────

  /**
   * Yesterday and today (UTC days). An order counts on the day it was paid,
   * as in the revenue report; failed, refunded and cancelled orders are not
   * sales, and refunds and owed lines come off (reports/sales-sql.ts). Cost is the frozen unit cost of the items that were not failed or
   * refunded, so profit = revenue − cost is known before delivery finishes.
   */
  private async salesByDay(yesterday: Date, today: Date): Promise<{ today: DayFigures; yesterday: DayFigures }> {
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; orders: number; revenue: string; cost: string }>>`
      SELECT date_trunc('day', o."paidAt") AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM(${NET_REVENUE}), 0)::text AS revenue,
             COALESCE(SUM(c.cost), 0)::text AS cost
      FROM "orders" o
      ${NET_JOINS}
      LEFT JOIN LATERAL (
        SELECT SUM(i."unitCost" * i."quantity") AS cost
        FROM "order_items" i
        WHERE i."orderId" = o."id" AND ${COUNTED_ITEM}
      ) c ON TRUE
      WHERE o."paidAt" >= ${yesterday} AND o."paidAt" < ${tomorrow}
        AND ${PAID_ORDER}
      GROUP BY 1
    `;

    const figures = (day: Date): DayFigures => {
      const row = rows.find((r) => new Date(r.day).getTime() === day.getTime());
      const revenue = new Prisma.Decimal(row?.revenue ?? 0);
      const cost = new Prisma.Decimal(row?.cost ?? 0);
      return {
        revenue: revenue.toFixed(2),
        cost: cost.toFixed(2),
        profit: revenue.minus(cost).toFixed(2),
        orders: row?.orders ?? 0,
      };
    };

    return { today: figures(today), yesterday: figures(yesterday) };
  }

  /** What is waiting for the owner: transfers to check, codes to relay, open tickets. */
  private async waiting() {
    const [pendingTransfers, pendingVerifications, openTickets] = await Promise.all([
      // the customer reported the transfer; the owner has not approved or rejected it yet
      this.prisma.payment.count({ where: { gateway: 'MANUAL', status: PaymentStatus.AUTHORIZED } }),
      // the same rows as GET /admin/verifications/pending (the dashboard counts them all)
      this.prisma.verificationToken.count({
        where: { codeEnc: { not: null }, consumedAt: null, expiresAt: { gt: new Date() }, user: { deletedAt: null } },
      }),
      this.prisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);
    return { pendingTransfers, pendingVerifications, openTickets };
  }

  /**
   * Active products that have had code stock at some point and are now at or
   * under the threshold. A product never stocked is delivered another way and
   * is not "low".
   */
  private lowStock(threshold: number) {
    return this.prisma.$queryRaw<Array<{ productId: string; sku: string; nameAr: string; available: number }>>`
      SELECT p."id" AS "productId", p."sku", p."nameAr",
             (COUNT(*) FILTER (
               WHERE NOT c."isUsed" AND (c."expiresAt" IS NULL OR c."expiresAt" > NOW())
             ))::int AS available
      FROM "products" p
      JOIN "product_codes" c ON c."productId" = p."id"
      WHERE p."deletedAt" IS NULL AND p."isActive"
      GROUP BY p."id", p."sku", p."nameAr"
      HAVING COUNT(*) FILTER (
               WHERE NOT c."isUsed" AND (c."expiresAt" IS NULL OR c."expiresAt" > NOW())
             ) <= ${threshold}
      ORDER BY available ASC, p."sku" ASC
      LIMIT 50
    `;
  }

  /**
   * Active products sold below cost or under the target margin. The price is
   * what the customer pays, after the owner's discount, so `sellPrice` here is
   * the discounted base price.
   */
  private async marginAlerts(target: number) {
    const products = await this.prisma.product.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, sku: true, nameAr: true, sellPrice: true, costPrice: true, discountPercent: true },
    });

    const alerts = products.flatMap((p) => {
      const sell = p.sellPrice.mul(new Prisma.Decimal(100).minus(p.discountPercent ?? 0)).div(100);
      const margin = sell.gt(0)
        ? sell.minus(p.costPrice).div(sell).mul(100)
        : new Prisma.Decimal(p.costPrice.gt(0) ? -100 : 0);
      const belowCost = sell.lt(p.costPrice);
      if (!belowCost && margin.gte(target)) return [];
      return [{
        productId: p.id,
        sku: p.sku,
        nameAr: p.nameAr,
        sellPrice: sell.toDecimalPlaces(4).toString(),
        costPrice: p.costPrice.toString(),
        discountPercent: p.discountPercent,
        marginPercent: margin.toDecimalPlaces(2).toNumber(),
      }];
    });

    return alerts.sort((a, b) => a.marginPercent - b.marginPercent).slice(0, 50);
  }
}
