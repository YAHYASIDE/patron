import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface PricedAmount {
  amount: Prisma.Decimal;      // in the requested currency
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

  async listCurrencies() {
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

  async getRate(quoteCurrency: string, at?: Date) {
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
    product: { id: string; sellPrice: Prisma.Decimal; prices: Array<{ currencyCode: string; sellPrice: Prisma.Decimal; isActive: boolean }> },
    currencyCode: string,
    preloaded?: { currency: { decimals: number; roundingMode: string; roundingStep: Prisma.Decimal | null }; rate: Prisma.Decimal; fxRateId: string | null; markup: Prisma.Decimal },
  ): Promise<PricedAmount> {
    const ctx = preloaded ?? {
      currency: await this.assertSupported(currencyCode),
      ...(await this.getRate(currencyCode).then((r) => ({ rate: r.rate, fxRateId: r.id }))),
      markup: await this.fxMarkup(),
    };

    const override = product.prices.find((p) => p.currencyCode === currencyCode && p.isActive);

    if (override) {
      return {
        amount: this.round(override.sellPrice, ctx.currency.decimals, ctx.currency.roundingMode, ctx.currency.roundingStep),
        currency: currencyCode,
        baseAmount: override.sellPrice.div(ctx.rate).toDecimalPlaces(4),
        baseCurrency: this.baseCurrency,
        fxRate: ctx.rate,
        fxRateId: null,
        isOverride: true,
      };
    }

    return {
      amount: this.round(
        product.sellPrice.mul(ctx.rate).mul(ctx.markup),
        ctx.currency.decimals, ctx.currency.roundingMode, ctx.currency.roundingStep,
      ),
      currency: currencyCode,
      baseAmount: product.sellPrice,
      baseCurrency: this.baseCurrency,
      fxRate: ctx.rate,
      fxRateId: ctx.fxRateId,
      isOverride: false,
    };
  }

  /** Batch context so a page of products shares one rate and one markup read. */
  async pricingContext(currencyCode: string) {
    const [currency, rate, markup] = await Promise.all([
      this.assertSupported(currencyCode),
      this.getRate(currencyCode),
      this.fxMarkup(),
    ]);
    return { currency, rate: rate.rate, fxRateId: rate.id, markup };
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

    const { rate, id: fxRateId } = await this.getRate(currencyCode);
    const override = product.prices[0];

    if (override) {
      // Reverse the override back into base currency for reporting.
      return {
        amount: this.round(override.sellPrice, currency.decimals, currency.roundingMode, currency.roundingStep),
        currency: currencyCode,
        baseAmount: override.sellPrice.div(rate).toDecimalPlaces(4),
        baseCurrency: this.baseCurrency,
        fxRate: rate,
        fxRateId: null,
        isOverride: true,
      };
    }

    const markup = await this.fxMarkup();
    const converted = product.sellPrice.mul(rate).mul(markup);

    return {
      amount: this.round(converted, currency.decimals, currency.roundingMode, currency.roundingStep),
      currency: currencyCode,
      baseAmount: product.sellPrice,
      baseCurrency: this.baseCurrency,
      fxRate: rate,
      fxRateId,
      isOverride: false,
    };
  }

  /** Convert an arbitrary base-currency amount (fees, coupon caps, refunds). */
  async convert(baseAmount: Prisma.Decimal | number, currencyCode: string): Promise<PricedAmount> {
    const currency = await this.assertSupported(currencyCode);
    const { rate, id } = await this.getRate(currencyCode);
    const base = new Prisma.Decimal(baseAmount);

    return {
      amount: this.round(base.mul(rate), currency.decimals, currency.roundingMode, currency.roundingStep),
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
