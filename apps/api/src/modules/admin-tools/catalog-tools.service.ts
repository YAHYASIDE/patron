import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { BulkPriceDto } from './admin-tools.dto';

/** SKUs are 3-40 characters (CreateProductDto); a copy must still pass the edit form. */
const SKU_MAX = 40;
const NAME_MAX = 120;

/** Bulk price change (#34) and product duplication (#45). */
@Injectable()
export class CatalogToolsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Move base sell prices by a percentage, rounded to 2 decimals. A price that
   * would fall below cost (after the product's own discount) is reported and
   * never applied, the same rule as the product form's loss guard.
   * Per-currency overrides (e.g. MRU face values) are the owner's fixed prices
   * and are left as they are.
   */
  async bulkPrice(dto: BulkPriceDto, actorId: string) {
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(dto.categoryId && { categoryId: dto.categoryId }),
        ...(dto.gameId && { gameId: dto.gameId }),
        ...(dto.productIds?.length && { id: { in: dto.productIds } }),
      },
      orderBy: { sku: 'asc' },
      select: { id: true, sku: true, nameAr: true, sellPrice: true, costPrice: true, discountPercent: true },
    });

    const factor = new Prisma.Decimal(100).plus(dto.percent).div(100);
    const items = products.map((p) => {
      const to = p.sellPrice.mul(factor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const paid = to.mul(new Prisma.Decimal(100).minus(p.discountPercent ?? 0)).div(100);
      return {
        id: p.id, sku: p.sku, nameAr: p.nameAr,
        from: p.sellPrice, to, costPrice: p.costPrice,
        belowCost: paid.lt(p.costPrice),
      };
    });

    const changes = items.filter((i) => !i.belowCost && !i.to.eq(i.from));
    if (!dto.dryRun && changes.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const c of changes) {
          await tx.product.update({ where: { id: c.id }, data: { sellPrice: c.to } });
          await this.audit.record(tx, {
            actorId, action: 'catalog.product.bulk_price', entityType: 'Product', entityId: c.id,
            before: { sellPrice: c.from }, after: { sellPrice: c.to, percent: dto.percent },
          });
        }
      }, { timeout: 60_000 });
    }

    return {
      items: items.map((i) => ({ ...i, from: i.from.toString(), to: i.to.toFixed(2), costPrice: i.costPrice.toString() })),
      applied: dto.dryRun ? 0 : changes.length,
    };
  }

  /** A copy to edit into a new denomination: SKU `<sku>-COPY[n]`, inactive, no codes, same prices. */
  async clone(id: string, actorId: string) {
    const source = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { prices: true } });
    if (!source) throw new NotFoundException('Product not found');

    const sku = await this.freeSku(source.sku);

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku,
          type: source.type,
          delivery: source.delivery,
          nameAr: this.suffixed(source.nameAr, ' (نسخة)'),
          nameEn: this.suffixed(source.nameEn, ' (copy)'),
          description: source.description,
          imageUrl: source.imageUrl,
          costPrice: source.costPrice,
          sellPrice: source.sellPrice,
          discountPercent: source.discountPercent,
          currency: source.currency,
          // a counted stock belongs to the original; the copy starts empty (null = unlimited stays)
          stockQty: source.stockQty === null ? null : 0,
          lowStockAlert: source.lowStockAlert,
          maxPerOrder: source.maxPerOrder,
          isActive: false,
          isFeatured: false,
          sortOrder: source.sortOrder,
          metadata: (source.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          etaMinutes: source.etaMinutes,
          categoryId: source.categoryId,
          gameId: source.gameId,
          prices: source.prices.length
            ? { create: source.prices.map((p) => ({ currencyCode: p.currencyCode, sellPrice: p.sellPrice, isActive: p.isActive })) }
            : undefined,
        },
        include: { prices: true },
      });
      await this.audit.record(tx, {
        actorId, action: 'catalog.product.clone', entityType: 'Product', entityId: product.id,
        after: { from: source.id, fromSku: source.sku, sku },
      });
      return product;
    });
  }

  /** `<sku>-COPY`, then `-COPY2`, `-COPY3`…, trimmed so the whole SKU stays within 40 characters. */
  private async freeSku(sku: string) {
    for (let n = 1; n <= 50; n++) {
      const suffix = n === 1 ? '-COPY' : `-COPY${n}`;
      const candidate = `${sku.slice(0, SKU_MAX - suffix.length)}${suffix}`;
      if (!(await this.prisma.product.findUnique({ where: { sku: candidate }, select: { id: true } }))) return candidate;
    }
    throw new BadRequestException('Too many copies of this product already exist');
  }

  private suffixed(name: string, suffix: string) {
    return `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;
  }
}
