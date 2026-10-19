import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../common/prisma/prisma.service';

const TEN_MINUTES = 10 * 60_000;
const BEST_SELLER_DAYS = 30;
export const MAX_BEST_SELLERS = 20;

interface Cached<T> {
  value: T;
  expiresAt: number;
}

/**
 * Public facts for the store's home page (#20, #27, #28): best sellers from
 * real deliveries, trust numbers from real counts, and today's exchange rates.
 * The first two are cached in memory for ten minutes; they are read on every
 * home page view and change slowly.
 */
@Injectable()
export class StoreFactsService {
  private bestSellerCache?: Cached<Array<{ productId: string; sku: string; gameId: string | null; units: number }>>;
  private statsCache?: Cached<{ ordersDelivered: number; customers: number }>;

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private get baseCurrency() {
    return this.config.get<string>('currency.base') ?? 'USD';
  }

  /** Units delivered in the last 30 days, per product still on sale. */
  async bestSellers(limit = 8) {
    const take = Math.min(Math.max(1, Math.floor(limit)), MAX_BEST_SELLERS);
    const now = Date.now();
    if (!this.bestSellerCache || this.bestSellerCache.expiresAt <= now) {
      const since = new Date(now - BEST_SELLER_DAYS * 864e5);
      const sold = await this.prisma.orderItem.groupBy({
        by: ['productId'],
        where: { status: 'DELIVERED', deliveredAt: { gte: since } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        // a few spare rows in case some top products were since hidden
        take: MAX_BEST_SELLERS * 2,
      });
      const products = await this.prisma.product.findMany({
        where: { id: { in: sold.map((s) => s.productId) }, deletedAt: null, isActive: true },
        select: { id: true, sku: true, gameId: true },
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      const value = sold.flatMap((s) => {
        const product = byId.get(s.productId);
        return product ? [{ productId: product.id, sku: product.sku, gameId: product.gameId, units: s._sum.quantity ?? 0 }] : [];
      });
      this.bestSellerCache = { value: value.slice(0, MAX_BEST_SELLERS), expiresAt: now + TEN_MINUTES };
    }
    return this.bestSellerCache.value.slice(0, take);
  }

  /** Orders delivered (fully or in part) and customer accounts. */
  async stats() {
    const now = Date.now();
    if (!this.statsCache || this.statsCache.expiresAt <= now) {
      const [ordersDelivered, customers] = await Promise.all([
        this.prisma.order.count({ where: { status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED'] } } }),
        this.prisma.user.count({ where: { deletedAt: null, roles: { some: { role: { name: 'customer' } } } } }),
      ]);
      this.statsCache = { value: { ordersDelivered, customers }, expiresAt: now + TEN_MINUTES };
    }
    return this.statsCache.value;
  }

  /** 1 base = <rate> quote, the latest rate in force for each active currency. */
  async rates(now = new Date()) {
    const base = this.baseCurrency;
    const rows = await this.prisma.fxRate.findMany({
      where: {
        baseCurrency: base,
        isActive: true,
        effectiveAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        quote: { isActive: true },
      },
      orderBy: [{ quoteCurrency: 'asc' }, { effectiveAt: 'desc' }],
      distinct: ['quoteCurrency'],
      select: { quoteCurrency: true, rate: true },
    });
    const rates: Record<string, number> = {};
    for (const row of rows) {
      if (row.quoteCurrency !== base) rates[row.quoteCurrency] = row.rate.toNumber();
    }
    return { base, rates };
  }
}
