import { AvailabilityProduct, availabilityMap } from '../catalog/availability';

import { PrismaService } from '../../common/prisma/prisma.service';

export type StockProduct = AvailabilityProduct;

/**
 * In stock exactly as the public catalogue reports it: the shared rule in
 * catalog/availability.ts, so a "back in stock" alert never rings for a
 * product the store still shows greyed out. Aggregate queries for any number
 * of products.
 */
export function inStockMap(prisma: PrismaService, products: StockProduct[]) {
  return availabilityMap(prisma, products);
}
