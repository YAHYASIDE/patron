import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * FX rates are append-only. A new rate supersedes the previous one rather than
 * overwriting it, so any historic order can still be re-derived at the rate it
 * was actually priced with.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  /**
   * How long a rate stays fresh, in minutes. A feed updates hourly, so three
   * hours without one means it broke; the owner types rates in by hand, so a
   * week-old one is normal.
   */
  static readonly FRESH_MINUTES = { FEED: 180, MANUAL: 7 * 24 * 60 } as const;

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private get baseCurrency() {
    return this.config.get<string>('currency.base') ?? 'USD';
  }

  /**
   * Record a new rate. A move of more than 15% is more often a bad feed than a
   * real devaluation, so a FEED rate like that is stored inactive for review.
   * A MANUAL rate is the owner's own number: a big move is applied once they
   * confirm it (409 BIG_CHANGE asks them first), never parked silently.
   */
  async recordRate(
    quoteCurrency: string,
    rate: number | Prisma.Decimal,
    source = 'MANUAL',
    createdById?: string,
    opts: { confirmed?: boolean } = {},
  ) {
    const value = new Prisma.Decimal(rate);
    if (value.lte(0)) throw new Error(`Refusing to record a non-positive rate for ${quoteCurrency}`);

    const current = await this.prisma.fxRate.findFirst({
      where: { baseCurrency: this.baseCurrency, quoteCurrency, isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });

    const change = current ? value.div(current.rate).minus(1) : null;
    const suspicious = !!change && change.abs().gt(new Prisma.Decimal(0.15));

    if (suspicious && source === 'MANUAL' && !opts.confirmed) {
      throw new ConflictException({
        message: `The rate for ${quoteCurrency} would move by more than 15%; confirm to apply it`,
        error: 'BIG_CHANGE',
        from: current!.rate.toString(),
        to: value.toString(),
        changePercent: Number(change!.times(100).toFixed(1)),
      });
    }
    const parked = suspicious && source !== 'MANUAL';
    if (parked) {
      this.logger.error(
        `Rate for ${quoteCurrency} moved from ${current!.rate} to ${value} (>15%) — recorded as inactive for review`,
      );
    }

    return this.prisma.fxRate.create({
      data: {
        baseCurrency: this.baseCurrency,
        quoteCurrency,
        rate: value,
        source,
        isActive: !parked,
        createdById,
      },
    });
  }

  /** What the owner can set: each active currency besides the base, with its current rate. */
  async overview(now = new Date()) {
    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true, isBase: false },
      orderBy: { code: 'asc' },
      select: { code: true, nameAr: true, symbol: true, decimals: true },
    });
    return Promise.all(
      currencies.map(async (c) => {
        const latest = await this.latestActive(c.code);
        return {
          ...c,
          rate: latest?.rate.toString() ?? null,
          source: latest?.source ?? null,
          effectiveAt: latest?.effectiveAt ?? null,
          stale: this.isStale(latest, now),
        };
      }),
    );
  }

  /** The owner's rate for one currency; only a currency the shop sells in. */
  async setManual(quoteCurrency: string, rate: number, actorId: string, confirmed = false) {
    const known = await this.prisma.currency.findFirst({
      where: { code: quoteCurrency, isActive: true, isBase: false },
      select: { code: true },
    });
    if (!known) throw new BadRequestException({ message: `Unknown currency ${quoteCurrency}`, error: 'UNKNOWN_CURRENCY' });
    return this.recordRate(quoteCurrency, rate, 'MANUAL', actorId, { confirmed });
  }

  private latestActive(quoteCurrency: string) {
    return this.prisma.fxRate.findFirst({
      where: { baseCurrency: this.baseCurrency, quoteCurrency, isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });
  }

  private isStale(latest: { source: string; effectiveAt: Date } | null, now: Date, maxAgeMinutes?: number) {
    if (!latest) return true;
    const minutes =
      maxAgeMinutes ?? (latest.source === 'FEED' ? FxService.FRESH_MINUTES.FEED : FxService.FRESH_MINUTES.MANUAL);
    return latest.effectiveAt.getTime() < now.getTime() - minutes * 60_000;
  }

  /** Pull the latest rates for every active currency from the configured feed. */
  async syncFromFeed() {
    const endpoint = this.config.get<string>('currency.feedUrl');
    if (!endpoint) {
      this.logger.warn('No FX feed configured — rates will go stale');
      return { updated: 0 };
    }

    const currencies = await this.prisma.currency.findMany({
      where: { isActive: true, isBase: false },
      select: { code: true },
    });

    const res = await fetch(`${endpoint}?base=${this.baseCurrency}`);
    if (!res.ok) throw new Error(`FX feed returned ${res.status}`);
    const payload = (await res.json()) as { rates: Record<string, number> };

    let updated = 0;
    for (const { code } of currencies) {
      const rate = payload.rates?.[code];
      if (!rate) {
        this.logger.warn(`FX feed did not return a rate for ${code}`);
        continue;
      }
      await this.recordRate(code, rate, 'FEED');
      updated += 1;
    }
    return { updated };
  }

  /** Currencies whose rate is too old to price with (see FRESH_MINUTES); one age for all when given. */
  async findStale(maxAgeMinutes?: number, now = new Date()) {
    const currencies = await this.prisma.currency.findMany({ where: { isActive: true, isBase: false } });

    const stale: string[] = [];
    for (const currency of currencies) {
      if (this.isStale(await this.latestActive(currency.code), now, maxAgeMinutes)) stale.push(currency.code);
    }
    return stale;
  }

  history(quoteCurrency: string, take = 50) {
    return this.prisma.fxRate.findMany({
      where: { baseCurrency: this.baseCurrency, quoteCurrency },
      orderBy: { effectiveAt: 'desc' },
      take,
    });
  }
}
