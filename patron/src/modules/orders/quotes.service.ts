import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DeliveryMode, Prisma, QuoteStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ReferenceService } from '../../common/reference/reference.service';
import { PricingService } from '../catalog/pricing.service';
import { ZERO, sum } from '../../common/money/money';
import { CreateQuoteDto, CreateQuoteItemDto } from './dto/order.dto';

/** The shape `present()` reads; see the note on PresentableOrder. */
interface PresentableQuote {
  expiresAt: Date;
  status: QuoteStatus;
  items?: Array<{
    inputs?: Array<{
      fieldKey: string;
      fieldLabel: string;
      value: string;
      isSensitive: boolean;
    }>;
  }>;
}

const QUOTE_TTL_MINUTES = 15;

interface GameInputField {
  key: string;
  labelAr: string;
  labelEn: string;
  required: boolean;
  regex?: string;
  sensitive?: boolean;
}

/**
 * A quote is a binding, time-boxed offer.
 *
 * Between browsing and paying, four things can move: the catalog price, the
 * provider's cost, the FX rate, and (later) the tax rate. If any of them is
 * read again at payment time, the customer is charged something other than
 * what they agreed to, or we sell below cost. All four are frozen here and the
 * order is built purely from the frozen values.
 */
@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private crypto: CryptoService,
    private reference: ReferenceService,
  ) {}

  async create(userId: string, dto: CreateQuoteDto, ip?: string) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    const currency = dto.currency ?? user.defaultCurrency;
    const currencyRow = await this.pricing.assertSupported(currency);

    const priced = await Promise.all(dto.items.map((item) => this.priceItem(item, currency)));

    const subtotal = sum(priced.map((p) => p.lineTotal));
    const totalCostBase = sum(priced.map((p) => p.unitCostBase.mul(p.quantity)));

    const coupon = dto.couponCode ? await this.resolveCoupon(dto.couponCode, userId, subtotal, currency) : null;
    const discount = coupon
      ? await this.discountFor(coupon, subtotal, currency, currencyRow.decimals)
      : ZERO();

    // Tax is 0 in MVP but flows through the same arithmetic, so switching it on
    // later needs no change to totals or to the CHECK constraint.
    const taxAmount = ZERO();
    const fees = ZERO();
    const total = subtotal.minus(discount).plus(fees).plus(taxAmount);

    const { rate, id: fxRateId } = await this.pricing.getRate(currency);

    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.checkoutQuote.create({
        data: {
          quoteNumber: await this.reference.quote(tx),
          userId,
          subtotal,
          discount,
          fees,
          taxAmount,
          total,
          currency,
          baseCurrency: this.pricing.baseCurrency,
          fxRate: rate,
          fxRateId,
          totalBase: total.div(rate).toDecimalPlaces(4),
          totalCostBase,
          couponId: coupon?.id,
          ipAddress: ip,
          expiresAt: new Date(Date.now() + QUOTE_TTL_MINUTES * 60_000),
          items: {
            create: priced.map((p) => ({
              productId: p.productId,
              productNameAr: p.productNameAr,
              productNameEn: p.productNameEn,
              quantity: p.quantity,
              unitPrice: p.unitPrice,
              unitPriceBase: p.unitPriceBase,
              unitCostBase: p.unitCostBase,
              lineTotal: p.lineTotal,
              plannedProviderId: p.plannedProviderId,
              inputs: { create: p.inputs },
            })),
          },
        },
        include: { items: { include: { inputs: true } } },
      });

      return this.present(quote);
    });
  }

  async findOne(id: string, userId: string) {
    const quote = await this.prisma.checkoutQuote.findUnique({
      where: { id },
      include: { items: { include: { inputs: true } } },
    });
    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.userId !== userId) throw new ForbiddenException('This quote belongs to another account');

    // Lazily expire on read so a client polling a stale quote sees the truth
    // even before the sweeper runs.
    if (quote.status === QuoteStatus.ACTIVE && quote.expiresAt < new Date()) {
      await this.prisma.checkoutQuote.update({ where: { id }, data: { status: QuoteStatus.EXPIRED } });
      quote.status = QuoteStatus.EXPIRED;
    }
    return this.present(quote);
  }

  /**
   * Bulk expiry, driven by the scheduled sweeper.
   *
   * Bounded. An unbounded `updateMany` after an incident could lock tens of
   * thousands of rows in one statement and block checkout for everyone; the
   * sweeper runs every minute, so a batch limit costs nothing and caps the
   * lock footprint.
   */
  async expireStale(batchSize = 5_000) {
    const stale = await this.prisma.checkoutQuote.findMany({
      where: { status: QuoteStatus.ACTIVE, expiresAt: { lt: new Date() } },
      select: { id: true },
      take: batchSize,
    });
    if (stale.length === 0) return 0;

    const { count } = await this.prisma.checkoutQuote.updateMany({
      where: { id: { in: stale.map((q) => q.id) }, status: QuoteStatus.ACTIVE },
      data: { status: QuoteStatus.EXPIRED },
    });
    return count;
  }

  // ─────────────── internals ───────────────

  private async priceItem(item: CreateQuoteItemDto, currency: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: item.productId, deletedAt: null, isActive: true },
      include: {
        game: true,
        providers: {
          where: { isActive: true, provider: { isActive: true, isHealthy: true } },
          orderBy: { priority: 'asc' },
          take: 1,
        },
      },
    });
    if (!product) throw new BadRequestException(`Product ${item.productId} is unavailable`);
    if (item.quantity > product.maxPerOrder) {
      throw new BadRequestException(`${product.nameEn}: maximum ${product.maxPerOrder} per order`);
    }

    await this.assertAvailable(product.id, product.delivery, product.stockQty, item.quantity);

    const price = await this.pricing.priceProduct(product.id, currency);
    const inputs = this.validateInputs(product.game?.inputSchema as unknown as GameInputField[] | null, item.inputs);

    // Prefer the live provider cost over the catalog's reference cost —
    // provider pricing drifts and margin should reflect what we will pay.
    const planned = product.providers[0];
    const unitCostBase = planned ? planned.providerCost : product.costPrice;

    return {
      productId: product.id,
      productNameAr: product.nameAr,
      productNameEn: product.nameEn,
      quantity: item.quantity,
      unitPrice: price.amount,
      unitPriceBase: price.baseAmount,
      unitCostBase,
      lineTotal: price.amount.mul(item.quantity),
      plannedProviderId: planned?.providerId ?? null,
      inputs,
    };
  }

  /**
   * Availability is a read-only check here. Reserving stock at quote time would
   * let anyone lock the entire code inventory for 15 minutes for free; the
   * authoritative allocation happens under a row lock at fulfilment.
   */
  private async assertAvailable(productId: string, delivery: DeliveryMode, stockQty: number | null, qty: number) {
    if (delivery === DeliveryMode.CODE_POOL) {
      const available = await this.prisma.productCode.count({ where: { productId, isUsed: false } });
      if (available < qty) throw new BadRequestException('Not enough stock for this product');
      return;
    }
    if (delivery === DeliveryMode.AUTO_PROVIDER) {
      const providers = await this.prisma.productProvider.count({
        where: { productId, isActive: true, provider: { isActive: true, isHealthy: true } },
      });
      if (providers === 0) throw new BadRequestException('This product is temporarily unavailable');
      return;
    }
    if (stockQty !== null && stockQty < qty) throw new BadRequestException('Not enough stock for this product');
  }

  private validateInputs(schema: GameInputField[] | null, provided?: Array<{ key: string; value: string }>) {
    if (!schema?.length) return [];
    const byKey = new Map((provided ?? []).map((i) => [i.key, i.value]));

    return schema.map((field) => {
      const value = byKey.get(field.key);
      if (field.required && !value?.trim()) {
        throw new BadRequestException(`Missing required field: ${field.labelEn}`);
      }
      if (value && field.regex && !new RegExp(field.regex).test(value)) {
        throw new BadRequestException(`Invalid format for ${field.labelEn}`);
      }
      return {
        fieldKey: field.key,
        fieldLabel: field.labelEn,
        // Sensitive values are encrypted at rest even before the order exists.
        value: field.sensitive ? this.crypto.encrypt(value ?? '') : (value ?? ''),
        isSensitive: !!field.sensitive,
      };
    });
  }

  private async resolveCoupon(code: string, userId: string, subtotal: Prisma.Decimal, currency: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { code: code.toUpperCase().trim() } });
    const now = new Date();

    if (!coupon || !coupon.isActive) throw new BadRequestException('Invalid coupon');
    if (coupon.startsAt && coupon.startsAt > now) throw new BadRequestException('This coupon is not active yet');
    if (coupon.expiresAt && coupon.expiresAt < now) throw new BadRequestException('This coupon has expired');
    if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
      throw new BadRequestException('This coupon has been fully redeemed');
    }

    if (coupon.maxUsesPerUser !== null) {
      const used = await this.prisma.order.count({
        where: { userId, couponId: coupon.id, status: { notIn: ['CANCELLED', 'FAILED'] } },
      });
      if (used >= coupon.maxUsesPerUser) throw new BadRequestException('You have already used this coupon');
    }

    if (coupon.minOrderTotal) {
      const threshold = await this.pricing.convert(coupon.minOrderTotal, currency);
      if (subtotal.lt(threshold.amount)) {
        throw new BadRequestException(`Minimum order total for this coupon is ${threshold.amount} ${currency}`);
      }
    }
    return coupon;
  }

  /**
   * PERCENT coupons apply to the quote currency directly. FIXED coupons are
   * denominated in the coupon's own currency (default: base) and converted, so
   * a "$5 off" coupon is worth $5 everywhere rather than 5 CFA in XOF.
   */
  private async discountFor(
    coupon: {
      discountType: string;
      discountValue: Prisma.Decimal;
      maxDiscount: Prisma.Decimal | null;
      currency: string | null;
    },
    subtotal: Prisma.Decimal,
    quoteCurrency: string,
    decimals: number,
  ) {
    let discount: Prisma.Decimal;

    if (coupon.discountType === 'PERCENT') {
      discount = subtotal.mul(coupon.discountValue).div(100);
      if (coupon.maxDiscount) {
        const cap = await this.convertFrom(coupon.maxDiscount, coupon.currency, quoteCurrency);
        if (discount.gt(cap)) discount = cap;
      }
    } else {
      discount = await this.convertFrom(coupon.discountValue, coupon.currency, quoteCurrency);
    }

    // A discount can reduce the total to zero but never below it.
    return Prisma.Decimal.min(discount, subtotal).toDecimalPlaces(decimals);
  }

  /** Convert an amount denominated in `from` (null = base) into `to`. */
  private async convertFrom(amount: Prisma.Decimal, from: string | null, to: string) {
    const base = this.pricing.baseCurrency;
    const source = from ?? base;
    if (source === to) return amount;

    // Route through base: coupon currency → base → quote currency.
    const inBase = source === base ? amount : amount.div((await this.pricing.getRate(source)).rate);
    return (await this.pricing.convert(inBase, to)).amount;
  }

  private present<T extends PresentableQuote>(quote: T) {
    const secondsRemaining = Math.max(0, Math.floor((quote.expiresAt.getTime() - Date.now()) / 1000));
    return {
      ...quote,
      items: quote.items?.map((i) => ({
        ...i,
        inputs: i.inputs?.map(({ value, isSensitive, ...rest }) => ({
          ...rest,
          // Never echo a decrypted sensitive value back to the client.
          value: isSensitive ? '••••' : value,
          isSensitive,
        })),
      })),
      secondsRemaining,
      isExpired: secondsRemaining === 0 || quote.status !== QuoteStatus.ACTIVE,
    };
  }
}
