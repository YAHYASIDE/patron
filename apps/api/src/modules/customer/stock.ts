import { DeliveryMode } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export interface StockProduct {
  id: string;
  delivery: DeliveryMode;
  stockQty: number | null;
}

/**
 * In stock exactly as the public catalogue reports it (ProductsService
 * stockForPage): CODE_POOL needs an unused code, AUTO_PROVIDER a healthy active
 * route, anything else a null (unlimited) or positive `stockQty`. Two
 * aggregate queries for any number of products.
 */
export async function inStockMap(prisma: PrismaService, products: StockProduct[]) {
  const result = new Map<string, boolean>();

  const codePool = products.filter((p) => p.delivery === DeliveryMode.CODE_POOL).map((p) => p.id);
  const autoProvider = products.filter((p) => p.delivery === DeliveryMode.AUTO_PROVIDER).map((p) => p.id);

  if (codePool.length) {
    const counts = await prisma.productCode.groupBy({
      by: ['productId'],
      where: { productId: { in: codePool }, isUsed: false },
      _count: { _all: true },
    });
    const available = new Map(counts.map((c) => [c.productId, c._count._all]));
    for (const id of codePool) result.set(id, (available.get(id) ?? 0) > 0);
  }

  if (autoProvider.length) {
    const counts = await prisma.productProvider.groupBy({
      by: ['productId'],
      where: { productId: { in: autoProvider }, isActive: true, provider: { isActive: true, isHealthy: true } },
      _count: { _all: true },
    });
    const available = new Map(counts.map((c) => [c.productId, c._count._all]));
    for (const id of autoProvider) result.set(id, (available.get(id) ?? 0) > 0);
  }

  for (const p of products) {
    if (!result.has(p.id)) result.set(p.id, p.stockQty === null || p.stockQty > 0);
  }
  return result;
}
