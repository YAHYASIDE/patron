import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Currency fields the rounding logic needs. Narrower than the full model. */
export interface RoundingRules {
  decimals: number;
  roundingMode: string;
  roundingStep: Prisma.Decimal | null;
}

/** A resolved FX rate. `id` is null for the base currency and for overrides. */
export interface ResolvedRate {
  id: string | null;
  rate: Prisma.Decimal;
}

/**
 * Everything needed to price one page of products with a single rate lookup.
 *
 * Declared explicitly because building it inline with a spread made TypeScript
 * infer a union of object shapes — `rate` and `fxRateId` then appeared to be
 * absent on one branch even though every branch supplied them.
 */
export interface PricingContext {
  currency: RoundingRules;
  rate: Prisma.Decimal;
  fxRateId: string | null;
  markup: Prisma.Decimal;
}

export interface PricedAmount {
  amount: Prisma.Decimal;      // in the requested currency, after the product discount
  listAmount: Prisma.Decimal;  // same, before the discount (equals amount when none)
  discountPercent: number;     // the product's own discount, 0 when none
  currency: string;
  baseAmount: Prisma.Decimal;  // same value in the platform base currency
  baseCurrency: string;
  fxRate: Prisma.Decimal;      // 1 base = fxRate requested
  fxRateId: string | null;     // null when currency === base, or a manual override
  isOverride: boolean;         // true = admin-set price, not converted
}

/**
 * Single source of truth for turning a base-currency price into what the
 * customer actually pays. Every order and payment stores the rate this
 * returns, so historic totals stay reproducible after rates move.
 */
@Injectable()
export class PricingService {
  constructor(private prisma: PrismaService, private config: ConfigService) {}

  get baseCurrency(): string {
    return this.config.get<string>('currency.base') ?? 'USD';
  }

  listCurrencies() {
    return this.prisma.currency.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async assertSupported(code: string) {
    const currency = await this.prisma.currency.findUnique({ where: { code } });
    if (!currency || !currency.isActive) throw new BadRequestException(`Currency ${code} is not supported`);
    return currency;
  }

  /**
   * Latest active rate for base → quote. Rates are append-only, so this reads
   * the most recent row that has already taken effect.
   */
  /**
   * Short-lived in-process cache. Pricing a 20-item catalog page previously
   * issued 20 identical rate lookups; rates change hourly at most, so a few
   * seconds of staleness is free. Quotes still read through `getRate` at
   * creation time and freeze the result, so this never affects a locked price.
   */
  private rateCache = new Map<string, { value: { id: string | null; rate: Prisma.Decimal }; expiresAt: number }>();
  private static readonly RATE_CACHE_MS = 5_000;

  async getRate(quoteCurrency: string, at?: Date): Promise<ResolvedRate> {
    if (quoteCurrency === this.baseCurrency) {
      return { id: null, rate: new Prisma.Decimal(1) };
    }

    const cacheable = !at;
    if (cacheable) {
      const hit = this.rateCache.get(quoteCurrency);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
    }
    at = at ?? new Date();

    const rate = await this.prisma.fxRate.findFirst({
      where: {
        baseCurrency: this.baseCurrency,
        quoteCurrency,
        isActive: true,
        effectiveAt: { lte: at },
        OR: [{ expiresAt: null }, { expiresAt: { gt: at } }],
      },
      orderBy: { effectiveAt: 'desc' },
    });
    if (!rate) throw new NotFoundException(`No exchange rate available for ${this.baseCurrency}→${quoteCurrency}`);

    const value = { id: rate.id, rate: rate.rate };
    if (cacheable) {
      this.rateCache.set(quoteCurrency, { value, expiresAt: Date.now() + PricingService.RATE_CACHE_MS });
    }
    return value;
  }

  /**
   * Price a product that has already been loaded, without re-querying it.
   * Used by list endpoints to price a page in one pass.
   */
  async priceLoadedProduct(
    product: {
      id: string;
      sellPrice: Prisma.Decimal;
      discountPercent?: number | null;
      prices: Array<{ currencyCode: string; sellPrice: Prisma.Decimal; isActive: boolean }>;
    },
    currencyCode: string,
    preloaded?: PricingContext,
  ): Promise<PricedAmount> {
    // `?? await` would build the context even when preloaded is supplied, so
    // resolve it explicitly and only when needed.
    const ctx: PricingContext = preloaded ?? (await this.pricingContext(currencyCode));
    const { decimals, roundingMode, roundingStep } = ctx.currency;
    const discountPercent = product.discountPercent ?? 0;
    const factor = PricingService.discountFactor(discountPercent);

    const override = product.prices.find((p) => p.currencyCode === currencyCode && p.isActive);

    if (override) {
      // The owner's discount applies to a per-currency override too.
      return {
        amount: this.round(override.sellPrice.mul(factor), decimals, roundingMode, roundingStep),
        listAmount: this.round(override.sellPrice, decimals, roundingMode, roundingStep),
        discountPercent,
        currency: currencyCode,
        baseAmount: override.sellPrice.mul(factor).div(ctx.rate).toDecimalPlaces(4),
        baseCurrency: this.baseCurrency,
        fxRate: ctx.rate,
        fxRateId: null,
        isOverride: true,
      };
    }

    const list = product.sellPrice.mul(ctx.rate).mul(ctx.markup);
    return {
      amount: this.round(list.mul(factor), decimals, roundingMode, roundingStep),
      listAmount: this.round(list, decimals, roundingMode, roundingStep),
      discountPercent,
      currency: currencyCode,
      baseAmount: product.sellPrice.mul(factor).toDecimalPlaces(4),
      baseCurrency: this.baseCurrency,
      fxRate: ctx.rate,
      fxRateId: ctx.fxRateId,
      isOverride: false,
    };
  }

  /** 15 → 0.85. The DTO caps the percent at 0–90. */
  private static discountFactor(percent: number): Prisma.Decimal {
    return new Prisma.Decimal(1).minus(new Prisma.Decimal(percent).div(100));
  }

  /** Batch context so a page of products shares one rate and one markup read. */
  async pricingContext(currencyCode: string): Promise<PricingContext> {
    const [currency, rate, markup] = await Promise.all([
      this.assertSupported(currencyCode),
      this.getRate(currencyCode),
      this.markupFor(currencyCode),
    ]);
    return { currency, rate: rate.rate, fxRateId: rate.id, markup };
  }

  /**
   * The FX markup covers exchange spread, so it only applies to converted
   * currencies. In the base currency there is no conversion: the customer pays
   * exactly the sell price the owner set.
   */
  private markupFor(currencyCode: string): Promise<Prisma.Decimal> {
    return currencyCode === this.baseCurrency ? Promise.resolve(new Prisma.Decimal(1)) : this.fxMarkup();
  }

  /**
   * Price a product in a target currency.
   * A manual ProductPrice override always wins — for XOF and MRU, a converted
   * price lands on ugly numbers customers don't recognise as a real price.
   */
  async priceProduct(productId: string, currencyCode: string): Promise<PricedAmount> {
    const currency = await this.assertSupported(currencyCode);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, deletedAt: null },
      include: { prices: { where: { currencyCode, isActive: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');

    // One pricing path for catalog pages, product pages and quotes, so the
    // store, the cart and the charged total can never disagree.
    const [{ rate, id: fxRateId }, markup] = await Promise.all([
      this.getRate(currencyCode),
      this.markupFor(currencyCode),
    ]);
    return this.priceLoadedProduct(product, currencyCode, { currency, rate, fxRateId, markup });
  }

  /** Convert an arbitrary base-currency amount (fees, coupon caps, refunds). */
  async convert(baseAmount: Prisma.Decimal | number, currencyCode: string): Promise<PricedAmount> {
    const currency = await this.assertSupported(currencyCode);
    const { rate, id } = await this.getRate(currencyCode);
    const base = new Prisma.Decimal(baseAmount);

    const amount = this.round(base.mul(rate), currency.decimals, currency.roundingMode, currency.roundingStep);
    return {
      amount,
      listAmount: amount,
      discountPercent: 0,
      currency: currencyCode,
      baseAmount: base,
      baseCurrency: this.baseCurrency,
      fxRate: rate,
      fxRateId: id,
      isOverride: false,
    };
  }

  /**
   * Rounding is currency-specific: XOF has no minor unit, so charging 2500.75
   * CFA is not a thing. roundingStep additionally snaps to a sane increment.
   */
  private round(
    value: Prisma.Decimal,
    decimals: number,
    mode: string,
    step: Prisma.Decimal | null,
  ): Prisma.Decimal {
    const rounding =
      mode === 'UP' ? Prisma.Decimal.ROUND_UP
      : mode === 'DOWN' ? Prisma.Decimal.ROUND_DOWN
      : Prisma.Decimal.ROUND_HALF_UP;

    let result = value.toDecimalPlaces(decimals, rounding);
    if (step && step.gt(0)) {
      result = result.div(step).toDecimalPlaces(0, rounding).mul(step);
    }
    return result;
  }

  /** Margin over the raw interbank rate, covering FX spread on settlement. */
  async fxMarkup(): Promise<Prisma.Decimal> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'currency.fx_markup_percent' } });
    const percent = typeof setting?.value === 'number' ? setting.value : 0;
    return new Prisma.Decimal(1).plus(new Prisma.Decimal(percent).div(100));
  }
}
