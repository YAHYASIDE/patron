import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/dto/pagination.dto';
import { PricingService } from './pricing.service';
import { CreateProductDto, QueryCatalogDto, UpdateProductDto } from './dto/catalog.dto';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private pricing: PricingService) {}

  /** Storefront listing — every product priced in the requested currency. */
  async findAllPublic(query: QueryCatalogDto) {
    const currency = query.currency ?? this.pricing.baseCurrency;
    await this.pricing.assertSupported(currency);

    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      isActive: true,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.gameId && { gameId: query.gameId }),
      ...(query.type && { type: query.type }),
      ...(query.isFeatured !== undefined && { isFeatured: query.isFeatured }),
      ...(query.search && {
        OR: [
          { nameEn: { contains: query.search, mode: 'insensitive' } },
          { nameAr: { contains: query.search } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        include: {
          category: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
          game: { select: { id: true, slug: true, nameAr: true, nameEn: true, inputSchema: true } },
          prices: { where: { currencyCode: currency, isActive: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    // One rate lookup, one markup read and one stock query for the whole page.
    // Previously each product triggered its own product fetch plus rate lookup:
    // 20 products meant ~41 queries to render one page.
    const ctx = await this.pricing.pricingContext(currency);
    const stock = await this.stockForPage(products);

    const priced = await Promise.all(
      products.map(async ({ costPrice, ...p }) => {
        const price = await this.pricing.priceLoadedProduct(p as any, currency, ctx);
        return {
          ...p,
          prices: undefined,
          sellPrice: price.amount,
          currency: price.currency,
          priceIsOverride: price.isOverride,
          inStock: stock.get(p.id) ?? true,
        };
      }),
    );

    return paginate(priced, total, query);
  }

  async findOnePublic(idOrSku: string, currencyCode?: string) {
    const currency = currencyCode ?? this.pricing.baseCurrency;
    const product = await this.prisma.product.findFirst({
      where: { deletedAt: null, isActive: true, OR: [{ id: idOrSku }, { sku: idOrSku }] },
      include: {
        category: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
        game: { select: { id: true, slug: true, nameAr: true, nameEn: true, inputSchema: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');

    const price = await this.pricing.priceProduct(product.id, currency);
    const { costPrice, ...visible } = product;

    return {
      ...visible,
      sellPrice: price.amount,
      currency: price.currency,
      priceIsOverride: price.isOverride,
      inStock: await this.isInStock(product.id, product.delivery, product.stockQty),
    };
  }

  /** Admin listing — includes cost, margin and inactive rows. */
  async findAllAdmin(query: QueryCatalogDto) {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.gameId && { gameId: query.gameId }),
      ...(query.type && { type: query.type }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.search && {
        OR: [
          { nameEn: { contains: query.search, mode: 'insensitive' } },
          { sku: { contains: query.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        include: {
          category: { select: { id: true, nameEn: true } },
          game: { select: { id: true, nameEn: true } },
          prices: { include: { currency: { select: { code: true, symbol: true } } } },
          providers: { include: { provider: { select: { id: true, code: true, name: true, isActive: true } } } },
          _count: { select: { codes: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return paginate(
      data.map((p) => ({
        ...p,
        marginPercent: p.sellPrice.gt(0)
          ? p.sellPrice.minus(p.costPrice).div(p.sellPrice).mul(100).toDecimalPlaces(2)
          : new Prisma.Decimal(0),
      })),
      total,
      query,
    );
  }

  async create(dto: CreateProductDto, actorId: string) {
    await this.assertValidRelations(dto);
    if (dto.sellPrice < dto.costPrice) {
      throw new BadRequestException('sellPrice is below costPrice — this product would sell at a loss');
    }
    for (const p of dto.prices ?? []) await this.pricing.assertSupported(p.currencyCode);

    const { prices, ...scalars } = dto;
    const product = await this.prisma.product.create({
      data: {
        ...scalars,
        currency: this.pricing.baseCurrency,
        metadata: dto.metadata as Prisma.InputJsonValue,
        prices: prices?.length ? { create: prices } : undefined,
      },
      include: { prices: true },
    });

    await this.audit(actorId, 'catalog.product.create', product.id, null, product);
    return product;
  }

  async update(id: string, dto: UpdateProductDto, actorId: string) {
    const before = await this.prisma.product.findFirst({ where: { id, deletedAt: null }, include: { prices: true } });
    if (!before) throw new NotFoundException('Product not found');
    await this.assertValidRelations(dto);

    const { prices, ...scalars } = dto;

    const after = await this.prisma.$transaction(async (tx) => {
      if (prices) {
        for (const p of prices) await this.pricing.assertSupported(p.currencyCode);
        await tx.productPrice.deleteMany({ where: { productId: id } });
        await tx.productPrice.createMany({ data: prices.map((p) => ({ ...p, productId: id })) });
      }
      return tx.product.update({
        where: { id },
        data: { ...scalars, metadata: dto.metadata as Prisma.InputJsonValue },
        include: { prices: true },
      });
    });

    await this.audit(actorId, 'catalog.product.update', id, before, after);
    return after;
  }

  async remove(id: string, actorId: string) {
    const open = await this.prisma.orderItem.count({
      where: { productId: id, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (open > 0) throw new BadRequestException(`${open} order item(s) are still being fulfilled`);

    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit(actorId, 'catalog.product.delete', id, null, null);
    return { message: 'Product deleted' };
  }

  /**
   * Resolve stock for an entire page in two aggregate queries instead of one
   * per product.
   */
  private async stockForPage(products: Array<{ id: string; delivery: DeliveryMode; stockQty: number | null }>) {
    const result = new Map<string, boolean>();

    const codePool = products.filter((p) => p.delivery === DeliveryMode.CODE_POOL).map((p) => p.id);
    const autoProvider = products.filter((p) => p.delivery === DeliveryMode.AUTO_PROVIDER).map((p) => p.id);

    if (codePool.length) {
      const counts = await this.prisma.productCode.groupBy({
        by: ['productId'],
        where: { productId: { in: codePool }, isUsed: false },
        _count: { _all: true },
      });
      const available = new Map(counts.map((c) => [c.productId, c._count._all]));
      for (const id of codePool) result.set(id, (available.get(id) ?? 0) > 0);
    }

    if (autoProvider.length) {
      const counts = await this.prisma.productProvider.groupBy({
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

  /**
   * CODE_POOL stock is derived from unused inventory rather than a stored
   * counter — a counter drifts the first time a fulfilment fails mid-flight.
   */
  private async isInStock(productId: string, delivery: DeliveryMode, stockQty: number | null) {
    if (delivery === DeliveryMode.CODE_POOL) {
      const available = await this.prisma.productCode.count({ where: { productId, isUsed: false } });
      return available > 0;
    }
    if (delivery === DeliveryMode.AUTO_PROVIDER) {
      const providers = await this.prisma.productProvider.count({
        where: { productId, isActive: true, provider: { isActive: true, isHealthy: true } },
      });
      return providers > 0;
    }
    return stockQty === null || stockQty > 0;
  }

  private async assertValidRelations(dto: CreateProductDto | UpdateProductDto) {
    const category = await this.prisma.category.findFirst({ where: { id: dto.categoryId, deletedAt: null } });
    if (!category) throw new BadRequestException('Invalid categoryId');

    if (dto.gameId) {
      const game = await this.prisma.game.findFirst({ where: { id: dto.gameId, deletedAt: null } });
      if (!game) throw new BadRequestException('Invalid gameId');
    }
    if (dto.type === 'GAME_TOPUP' && !dto.gameId) {
      throw new BadRequestException('GAME_TOPUP products must be linked to a game');
    }
  }

  private audit(userId: string, action: string, entityId: string, before: unknown, after: unknown) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Product', entityId, before: before as any, after: after as any },
    });
  }
}
