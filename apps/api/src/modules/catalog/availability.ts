import { DeliveryMode } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Whether a customer can order a product — the one rule the catalogue (list
 * and detail), the "back in stock" alerts, the admin list and checkout share,
 * so the store never shows as orderable what checkout refuses.
 *
 * - CODE_POOL: an unused code exists.
 * - AUTO_PROVIDER: an active route to an active, healthy provider exists.
 * - MANUAL (owner's decision, 15 Nov 2026): the owner can actually deliver it —
 *   live code stock (what deliverFromStock hands out), or a link to an active
 *   supplier (even with automatic delivery off: the owner buys there by hand),
 *   or «أسلّمه بنفسي» (`selfDelivery`) — and `stockQty` is null or above 0.
 *
 * Anything else stays visible in the store, greyed out, and cannot be ordered.
 */
export interface AvailabilityProduct {
  id: string;
  delivery: DeliveryMode;
  stockQty: number | null;
  selfDelivery?: boolean;
  isActive?: boolean;
  deletedAt?: Date | null;
}

/** Where a product's delivery can come from, as counts. */
export interface DeliverySources {
  /** unused codes (CODE_POOL), or unused and unexpired codes (MANUAL code stock) */
  codes: number;
  /** active links to an active, healthy provider: automatic delivery */
  routes: number;
  /** links of any state to an active supplier */
  suppliers: number;
}

export const NO_SOURCES: DeliverySources = { codes: 0, routes: 0, suppliers: 0 };

/** The delivery half of the rule, without the `stockQty` cap. */
export function hasDeliverySource(product: AvailabilityProduct, sources: DeliverySources): boolean {
  if (product.delivery === DeliveryMode.CODE_POOL) return sources.codes > 0;
  if (product.delivery === DeliveryMode.AUTO_PROVIDER) return sources.routes > 0;
  return !!product.selfDelivery || sources.codes > 0 || sources.suppliers > 0;
}

/** The whole rule for one product, given its sources. */
export function isAvailable(product: AvailabilityProduct, sources: DeliverySources): boolean {
  if (product.isActive === false || product.deletedAt) return false;
  if (!hasDeliverySource(product, sources)) return false;
  // CODE_POOL and AUTO_PROVIDER count their own stock; stockQty caps MANUAL only
  if (product.delivery !== DeliveryMode.MANUAL) return true;
  return product.stockQty === null || product.stockQty > 0;
}

const byProduct = (rows: Array<{ productId: string; _count: { _all: number } }>) =>
  new Map(rows.map((r) => [r.productId, r._count._all]));

/**
 * Sources for any number of products in at most four aggregate queries
 * (never one per product). A self-delivered MANUAL product needs none.
 */
export async function loadDeliverySources(prisma: PrismaService, products: AvailabilityProduct[]) {
  const codePool = products.filter((p) => p.delivery === DeliveryMode.CODE_POOL).map((p) => p.id);
  const auto = products.filter((p) => p.delivery === DeliveryMode.AUTO_PROVIDER).map((p) => p.id);
  const manual = products.filter((p) => p.delivery === DeliveryMode.MANUAL && !p.selfDelivery).map((p) => p.id);
  const now = new Date();

  const [poolCodes, manualCodes, routes, suppliers] = await Promise.all([
    codePool.length
      ? prisma.productCode.groupBy({
          by: ['productId'],
          where: { productId: { in: codePool }, isUsed: false },
          _count: { _all: true },
        })
      : [],
    manual.length
      ? prisma.productCode.groupBy({
          by: ['productId'],
          where: { productId: { in: manual }, isUsed: false, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          _count: { _all: true },
        })
      : [],
    auto.length
      ? prisma.productProvider.groupBy({
          by: ['productId'],
          where: { productId: { in: auto }, isActive: true, provider: { isActive: true, isHealthy: true } },
          _count: { _all: true },
        })
      : [],
    manual.length
      ? prisma.productProvider.groupBy({
          by: ['productId'],
          where: { productId: { in: manual }, provider: { isActive: true } },
          _count: { _all: true },
        })
      : [],
  ]);

  const codes = new Map([...byProduct(poolCodes), ...byProduct(manualCodes)]);
  const routeCounts = byProduct(routes);
  const supplierCounts = byProduct(suppliers);
  return new Map<string, DeliverySources>(
    products.map((p) => [
      p.id,
      { codes: codes.get(p.id) ?? 0, routes: routeCounts.get(p.id) ?? 0, suppliers: supplierCounts.get(p.id) ?? 0 },
    ]),
  );
}

/** product id → orderable, for a page of products. */
export async function availabilityMap(prisma: PrismaService, products: AvailabilityProduct[]) {
  const sources = await loadDeliverySources(prisma, products);
  return new Map(products.map((p) => [p.id, isAvailable(p, sources.get(p.id) ?? NO_SOURCES)]));
}
