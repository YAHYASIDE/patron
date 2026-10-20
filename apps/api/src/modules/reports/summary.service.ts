import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { MANUAL_ACCOUNTS_KEY, ManualAccount, normalizeAccount } from '../payments/gateways/manual.gateway';
import { ReportSummaryQueryDto } from './dto/summary.dto';
import { COUNTED_ITEM, NET_JOINS, NET_REVENUE, PAID_ORDER as PAID } from './sales-sql';

const DAY_MS = 86_400_000;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const usd = (v: Prisma.Decimal) => v.toFixed(2);
const pct = (part: Prisma.Decimal, whole: Prisma.Decimal) =>
  whole.gt(0) ? part.div(whole).mul(100).toDecimalPlaces(1).toNumber() : 0;

/** An item line sold under its cost by more than half a cent (fx rounding is not a loss). */
const BELOW_COST = Prisma.sql`i."unitCost" * i."quantity" - i."lineTotal" / o."fxRate" > 0.005`;

/** How the owner names the ways customers pay. */
export const WALLET_LABEL = 'المحفظة';
export const CARD_LABEL = 'بطاقة';
export const TRANSFER_LABEL = 'تحويل';
export const OTHER_LABEL = 'أخرى';

type DayRow = { day: Date; orders: number; revenue: string; cost: string; delivered: number };
type MethodRow = { key: string; gateway: string | null; name: string | null; orders: number; revenue: string };
type ProductRow = {
  productId: string; sku: string; nameAr: string; units: number; revenue: string; profit: string;
  belowUnits: number; belowLoss: string;
};
type LossRow = { refunds: string; refundCount: number; owedCount: number; owedValue: string };

export interface PayMethod {
  method: string;
  /** MANUAL (a transfer app), WALLET, CARD, or OTHER (no captured payment on record). */
  gateway: 'MANUAL' | 'WALLET' | 'CARD' | 'OTHER';
  /** The logo the owner chose for this transfer app, when there is one. */
  logo: string | null;
  orders: number;
  revenue: string;
}

/**
 * Everything the owner's reports page shows, in one request: profit and
 * losses, today's cash per payment app, best customers and products, and a
 * per-day series. Money is in the base currency (USD): an order's
 * `totalBase`, and each item's cost frozen at quote time.
 */
@Injectable()
export class ReportSummaryService {
  constructor(private prisma: PrismaService) {}

  async summary(query: ReportSummaryQueryDto, now = new Date()) {
    const { from, to } = query.resolve(now);
    const todayStart = new Date(new Date(now).setUTCHours(0, 0, 0, 0));
    const tomorrow = new Date(todayStart.getTime() + DAY_MS);

    const [days, todayRows, methods, todayMethods, customers, products, countries, losses, logos] =
      await Promise.all([
        this.days(from, to),
        this.days(todayStart, tomorrow),
        this.methods(from, to),
        this.methods(todayStart, tomorrow),
        this.customers(from, to),
        this.products(from, to),
        this.countries(from, to),
        this.losses(from, to),
        this.logos(),
      ]);

    // ── totals and the per-day series (every day present) ──
    const byDay = new Map(days.map((r) => [new Date(r.day).getTime(), r]));
    const series: Array<{ date: string; revenue: string; cost: string; profit: string; orders: number }> = [];
    let revenue = D(0);
    let cost = D(0);
    let orders = 0;
    let delivered = 0;
    const last = new Date(to.getTime() - 1).setUTCHours(0, 0, 0, 0);
    for (let t = new Date(from).setUTCHours(0, 0, 0, 0); t <= last; t += DAY_MS) {
      const row = byDay.get(t);
      const r = D(row?.revenue ?? 0);
      const c = D(row?.cost ?? 0);
      revenue = revenue.plus(r);
      cost = cost.plus(c);
      orders += row?.orders ?? 0;
      delivered += row?.delivered ?? 0;
      series.push({
        date: new Date(t).toISOString().slice(0, 10),
        revenue: usd(r),
        cost: usd(c),
        profit: usd(r.minus(c)),
        orders: row?.orders ?? 0,
      });
    }
    const profit = revenue.minus(cost);

    // ── today ──
    const t = todayRows[0];
    const tRevenue = D(t?.revenue ?? 0);
    const tCost = D(t?.cost ?? 0);
    const today = {
      revenue: usd(tRevenue),
      cost: usd(tCost),
      profit: usd(tRevenue.minus(tCost)),
      orders: t?.orders ?? 0,
      // money that actually came in today; a wallet payment spends a balance received earlier
      cashByMethod: this.label(todayMethods, logos)
        .filter((m) => m.gateway !== 'WALLET')
        .map((m) => ({ method: m.method, gateway: m.gateway, logo: m.logo, amount: m.revenue, orders: m.orders })),
      walletUsed: (() => {
        const w = this.label(todayMethods, logos).find((m) => m.gateway === 'WALLET');
        return { amount: w?.revenue ?? '0.00', orders: w?.orders ?? 0 };
      })(),
    };

    // ── losses ──
    const belowCost = products
      .filter((p) => D(p.belowLoss).gt(0))
      .sort((a, b) => D(b.belowLoss).cmp(D(a.belowLoss)))
      .map((p) => ({ productId: p.productId, sku: p.sku, nameAr: p.nameAr, units: p.belowUnits, loss: usd(D(p.belowLoss)) }));
    const belowTotal = products.reduce((s, p) => s.plus(p.belowLoss), D(0));
    const l = losses[0] ?? { refunds: '0', refundCount: 0, owedCount: 0, owedValue: '0' };

    return {
      range: { from, to },
      totals: {
        revenue: usd(revenue),
        cost: usd(cost),
        profit: usd(profit),
        marginPercent: pct(profit, revenue),
        orders,
        itemsDelivered: delivered,
        averageOrder: usd(orders > 0 ? revenue.div(orders) : D(0)),
      },
      losses: {
        // already taken off the sales: shown so the owner sees what went back, never subtracted twice
        refunds: usd(D(l.refunds)),
        refundCount: l.refundCount,
        belowCost: belowCost.slice(0, 20),
        belowCostTotal: usd(belowTotal),
        // paid but not delivered and not refunded yet: money the customers are owed
        owed: { count: l.owedCount, value: usd(D(l.owedValue)) },
        // the only real loss: what was sold under its cost
        total: usd(belowTotal),
      },
      today,
      byMethod: this.label(methods, logos).map((m) => ({ ...m, share: pct(D(m.revenue), revenue) })),
      topCustomers: customers.map((c) => ({
        ...c, spent: usd(D(c.spent)), profit: usd(D(c.profit)),
      })),
      topProducts: [...products]
        .sort((a, b) => b.units - a.units || D(b.revenue).cmp(D(a.revenue)))
        .slice(0, 10)
        .map((p) => ({
          productId: p.productId, sku: p.sku, nameAr: p.nameAr, units: p.units,
          revenue: usd(D(p.revenue)), profit: usd(D(p.profit)),
        })),
      byCountry: countries.map((c) => ({ ...c, revenue: usd(D(c.revenue)) })),
      series,
    };
  }

  // ─────────────── parts ───────────────

  /** Paid orders per UTC day with their revenue, frozen cost and delivered units (same SQL as InsightsService). */
  private days(from: Date, to: Date) {
    return this.prisma.$queryRaw<DayRow[]>`
      SELECT date_trunc('day', o."paidAt") AS day,
             COUNT(*)::int AS orders,
             COALESCE(SUM(${NET_REVENUE}), 0)::text AS revenue,
             COALESCE(SUM(c.cost), 0)::text AS cost,
             COALESCE(SUM(c.delivered), 0)::int AS delivered
      FROM "orders" o
      ${NET_JOINS}
      LEFT JOIN LATERAL (
        SELECT SUM(i."unitCost" * i."quantity") AS cost,
               SUM(i."quantity") FILTER (WHERE i."status" = 'DELIVERED') AS delivered
        FROM "order_items" i
        WHERE i."orderId" = o."id" AND ${COUNTED_ITEM}
      ) c ON TRUE
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND ${PAID}
      GROUP BY 1
    `;
  }

  /**
   * Paid orders by how they were paid: the payment that captured the order.
   * Transfers group by the app the customer named (Bankily, Masrvi, ...),
   * case and spaces ignored.
   */
  private methods(from: Date, to: Date) {
    return this.prisma.$queryRaw<MethodRow[]>`
      SELECT CASE
               WHEN p."gateway" IS NULL THEN 'other'
               WHEN p."gateway" = 'WALLET' THEN 'wallet'
               WHEN p."gateway" = 'MANUAL' THEN 'm:' || COALESCE(LOWER(NULLIF(BTRIM(p."rawResponse"->'transfer'->>'method'), '')), '')
               ELSE 'card'
             END AS key,
             MIN(p."gateway"::text) AS gateway,
             MIN(NULLIF(BTRIM(p."rawResponse"->'transfer'->>'method'), '')) AS name,
             COUNT(*)::int AS orders,
             COALESCE(SUM(${NET_REVENUE}), 0)::text AS revenue
      FROM "orders" o
      ${NET_JOINS}
      LEFT JOIN LATERAL (
        SELECT y."gateway", y."rawResponse"
        FROM "payments" y
        WHERE y."orderId" = o."id" AND y."status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
        ORDER BY y."capturedAt" DESC NULLS LAST, y."createdAt" DESC
        LIMIT 1
      ) p ON TRUE
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND ${PAID}
      GROUP BY 1
      ORDER BY SUM(${NET_REVENUE}) DESC, COUNT(*) DESC
    `;
  }

  /** The ten customers who spent the most, with the profit their orders made. */
  private customers(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<{
      id: string; fullName: string; phone: string | null; country: string | null;
      orders: number; spent: string; profit: string; lastOrderAt: Date;
    }>>`
      SELECT u."id", u."fullName", u."phone", u."country",
             COUNT(*)::int AS orders,
             SUM(${NET_REVENUE})::text AS spent,
             SUM(${NET_REVENUE} - COALESCE(c.cost, 0))::text AS profit,
             MAX(o."paidAt") AS "lastOrderAt"
      FROM "orders" o
      JOIN "users" u ON u."id" = o."userId"
      ${NET_JOINS}
      LEFT JOIN LATERAL (
        SELECT SUM(i."unitCost" * i."quantity") AS cost
        FROM "order_items" i
        WHERE i."orderId" = o."id" AND ${COUNTED_ITEM}
      ) c ON TRUE
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND ${PAID}
      GROUP BY u."id"
      ORDER BY SUM(${NET_REVENUE}) DESC, COUNT(*) DESC
      LIMIT 10
    `;
  }

  /**
   * Every product sold in the period (one row each): units, revenue and profit
   * per line, and what the lines sold under cost lost. Best sellers and
   * below-cost sales are both cut from this one scan.
   */
  private products(from: Date, to: Date) {
    return this.prisma.$queryRaw<ProductRow[]>`
      SELECT i."productId" AS "productId", pr."sku", pr."nameAr" AS "nameAr",
             SUM(i."quantity")::int AS units,
             SUM(i."lineTotal" / o."fxRate")::text AS revenue,
             SUM(i."lineTotal" / o."fxRate" - i."unitCost" * i."quantity")::text AS profit,
             COALESCE(SUM(i."quantity") FILTER (WHERE ${BELOW_COST}), 0)::int AS "belowUnits",
             COALESCE(SUM(i."unitCost" * i."quantity" - i."lineTotal" / o."fxRate") FILTER (WHERE ${BELOW_COST}), 0)::text AS "belowLoss"
      FROM "order_items" i
      JOIN "orders" o ON o."id" = i."orderId"
      JOIN "products" pr ON pr."id" = i."productId"
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND ${PAID} AND ${COUNTED_ITEM}
      GROUP BY i."productId", pr."sku", pr."nameAr"
    `;
  }

  private countries(from: Date, to: Date) {
    return this.prisma.$queryRaw<Array<{ country: string | null; orders: number; revenue: string }>>`
      SELECT u."country", COUNT(*)::int AS orders, COALESCE(SUM(${NET_REVENUE}), 0)::text AS revenue
      FROM "orders" o
      JOIN "users" u ON u."id" = o."userId"
      ${NET_JOINS}
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND ${PAID}
      GROUP BY u."country"
      ORDER BY SUM(${NET_REVENUE}) DESC
    `;
  }

  /**
   * Money given back in the period (refunds processed; already taken off the
   * sales above, shown for the record), and what customers are still owed:
   * paid orders, or lines of them, that failed or were cancelled and are not
   * refunded yet.
   */
  private losses(from: Date, to: Date) {
    return this.prisma.$queryRaw<LossRow[]>`
      SELECT (SELECT COALESCE(SUM(r."amountBase"), 0) FROM "refunds" r
               WHERE r."status" = 'PROCESSED' AND r."processedAt" >= ${from} AND r."processedAt" < ${to})::text AS refunds,
             (SELECT COUNT(*) FROM "refunds" r
               WHERE r."status" = 'PROCESSED' AND r."processedAt" >= ${from} AND r."processedAt" < ${to})::int AS "refundCount",
             COUNT(o."id") FILTER (WHERE owed.value > 0.005)::int AS "owedCount",
             COALESCE(SUM(owed.value) FILTER (WHERE owed.value > 0.005), 0)::text AS "owedValue"
      FROM "orders" o
      ${NET_JOINS}
      CROSS JOIN LATERAL (
        SELECT CASE
                 WHEN o."status" IN ('FAILED', 'CANCELLED') THEN o."totalBase" - COALESCE(rf.refunded, 0)
                 ELSE COALESCE(fl.owed, 0) - COALESCE(rf.refunded, 0)
               END AS value
      ) owed
      WHERE o."paidAt" >= ${from} AND o."paidAt" < ${to} AND o."status" <> 'REFUNDED'
    `;
  }

  /** The logo the owner picked for each transfer app, by app name (a switched-on account wins). */
  private async logos(): Promise<Map<string, string>> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_ACCOUNTS_KEY } });
    const accounts = Array.isArray(row?.value) ? (row.value as unknown as ManualAccount[]).map(normalizeAccount) : [];
    const map = new Map<string, string>();
    for (const a of [...accounts].sort((x, y) => Number(y.enabled) - Number(x.enabled))) {
      const key = a.method.trim().toLowerCase();
      if (a.logo && key && !map.has(key)) map.set(key, a.logo);
    }
    return map;
  }

  /** Arabic names for the ways to pay: the app's own name for a transfer. */
  private label(rows: MethodRow[], logos: Map<string, string>): PayMethod[] {
    return rows.map((r): PayMethod => {
      const base = { orders: r.orders, revenue: usd(D(r.revenue)) };
      if (r.key === 'wallet') return { method: WALLET_LABEL, gateway: 'WALLET', logo: null, ...base };
      if (r.key === 'card') return { method: CARD_LABEL, gateway: 'CARD', logo: null, ...base };
      if (r.key.startsWith('m:')) {
        const name = r.name ?? TRANSFER_LABEL;
        return { method: name, gateway: 'MANUAL', logo: logos.get(r.key.slice(2)) ?? null, ...base };
      }
      return { method: OTHER_LABEL, gateway: 'OTHER', logo: null, ...base };
    });
  }
}
