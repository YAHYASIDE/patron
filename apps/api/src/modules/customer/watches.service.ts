import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateWatchDto } from './dto/customer.dto';
import { inStockMap } from './stock';

/** Enough for any real customer; stops a script from watching the whole catalogue. */
export const MAX_WATCHES = 50;
/** Armed watches read per run; the rest wait for the next hour. */
const BATCH = 5_000;

const WATCH_FIELDS = {
  id: true, productId: true, kind: true, priceAtWatch: true, notifiedAt: true, createdAt: true,
  product: { select: { id: true, sku: true, nameAr: true, nameEn: true, gameId: true } },
} satisfies Prisma.PriceWatchSelect;

/**
 * What the customer pays in the base currency today: the owner's discount
 * applied, as PricingService computes `baseAmount`.
 */
export function basePrice(product: { sellPrice: Prisma.Decimal; discountPercent: number | null }) {
  const factor = new Prisma.Decimal(1).minus(new Prisma.Decimal(product.discountPercent ?? 0).div(100));
  return product.sellPrice.mul(factor).toDecimalPlaces(4);
}

/** "Tell me when the price drops" (#11) and "tell me when it is back" (#12). */
@Injectable()
export class WatchesService {
  private readonly logger = new Logger(WatchesService.name);

  constructor(private prisma: PrismaService, private notifications: NotificationsService) {}

  list(userId: string) {
    return this.prisma.priceWatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: WATCH_FIELDS,
    });
  }

  /**
   * Idempotent per product and kind. Asking again after an alert re-arms the
   * watch from today's price; asking again while it is armed changes nothing.
   */
  async create(userId: string, dto: CreateWatchDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, deletedAt: null, isActive: true },
      select: { id: true, sellPrice: true, discountPercent: true, delivery: true, stockQty: true },
    });
    if (!product) throw new NotFoundException('Product not found');

    const key = { userId_productId_kind: { userId, productId: product.id, kind: dto.kind } };
    const existing = await this.prisma.priceWatch.findUnique({ where: key, select: { id: true, notifiedAt: true } });
    if (existing && !existing.notifiedAt) {
      return this.prisma.priceWatch.findUniqueOrThrow({ where: { id: existing.id }, select: WATCH_FIELDS });
    }

    if (dto.kind === 'stock') {
      const stock = await inStockMap(this.prisma, [product]);
      if (stock.get(product.id)) {
        throw new BadRequestException({ message: 'This product is in stock', error: 'ALREADY_IN_STOCK' });
      }
    }
    if (!existing && (await this.prisma.priceWatch.count({ where: { userId } })) >= MAX_WATCHES) {
      throw new BadRequestException({ message: 'Too many alerts', error: 'TOO_MANY_WATCHES' });
    }

    const priceAtWatch = basePrice(product);
    return this.prisma.priceWatch.upsert({
      where: key,
      create: { userId, productId: product.id, kind: dto.kind, priceAtWatch },
      update: { priceAtWatch, notifiedAt: null },
      select: WATCH_FIELDS,
    });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.priceWatch.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Alert not found');
    return { deleted: true as const };
  }

  /**
   * The hourly sweep. A watch fires once: `notifiedAt` is claimed in the same
   * transaction as the notification row, so two overlapping runs cannot ring
   * the bell twice.
   */
  async runChecks() {
    const watches = await this.prisma.priceWatch.findMany({
      where: { notifiedAt: null, product: { deletedAt: null, isActive: true } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: {
        id: true, userId: true, kind: true, priceAtWatch: true,
        product: {
          select: {
            id: true, sku: true, nameAr: true, nameEn: true,
            sellPrice: true, discountPercent: true, delivery: true, stockQty: true,
          },
        },
      },
    });
    if (!watches.length) return { checked: 0, notified: 0 };

    // stock is only looked up for products someone waits on
    const stockProducts = new Map(watches.filter((w) => w.kind === 'stock').map((w) => [w.product.id, w.product]));
    const stock = await inStockMap(this.prisma, [...stockProducts.values()]);

    let notified = 0;
    for (const watch of watches) {
      const { product } = watch;
      const due = watch.kind === 'stock'
        ? stock.get(product.id) === true
        : basePrice(product).lt(watch.priceAtWatch);
      if (!due) continue;

      try {
        const sent = await this.prisma.$transaction(async (tx) => {
          const claimed = await tx.priceWatch.updateMany({
            where: { id: watch.id, notifiedAt: null },
            data: { notifiedAt: new Date() },
          });
          if (!claimed.count) return false;
          await this.notifications.notify(this.message(watch.userId, watch.kind, product), tx);
          return true;
        });
        if (sent) notified += 1;
      } catch (err) {
        // one bad row must not stop everyone else's alerts
        this.logger.error(`Watch ${watch.id} failed: ${(err as Error).message}`);
      }
    }
    return { checked: watches.length, notified };
  }

  private message(
    userId: string,
    kind: string,
    product: { id: string; sku: string; nameAr: string; nameEn: string },
  ) {
    const common = { userId, productId: product.id, link: `/products/${encodeURIComponent(product.sku)}` };
    if (kind === 'stock') {
      return {
        ...common,
        type: 'watch.stock' as const,
        ar: { title: 'عاد متوفرًا', body: `${product.nameAr} متوفر الآن. اطلبه قبل أن ينفد.` },
        en: { title: 'Back in stock', body: `${product.nameEn} is available again. Order it before it runs out.` },
        fr: { title: 'De retour en stock', body: `${product.nameEn} est de nouveau disponible. Commandez avant la rupture.` },
      };
    }
    return {
      ...common,
      type: 'watch.price' as const,
      ar: { title: 'انخفض السعر', body: `نزل سعر ${product.nameAr}. اطلبه الآن قبل أن يتغيّر.` },
      en: { title: 'Price drop', body: `${product.nameEn} is now cheaper. Order it before the price changes.` },
      fr: { title: 'Baisse de prix', body: `${product.nameEn} est moins cher. Commandez avant que le prix ne change.` },
    };
  }
}
