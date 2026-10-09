import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private prisma: PrismaService, private config: ConfigService) {}

  private get baseCurrency() {
    return this.config.get<string>('currency.base') ?? 'USD';
  }

  async recordRate(quoteCurrency: string, rate: number | Prisma.Decimal, source = 'MANUAL', createdById?: string) {
    const value = new Prisma.Decimal(rate);
    if (value.lte(0)) throw new Error(`Refusing to record a non-positive rate for ${quoteCurrency}`);

    const current = await this.prisma.fxRate.findFirst({
      where: { baseCurrency: this.baseCurrency, quoteCurrency, isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });

    // A sudden large move is more often a bad feed than a real devaluation.
    // Record it inactive so pricing keeps using the last trusted rate until
    // an operator confirms.
    const suspicious =
      current && value.div(current.rate).minus(1).abs().gt(new Prisma.Decimal(0.15));

    if (suspicious) {
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
        isActive: !suspicious,
        createdById,
      },
    });
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

  /** Rates older than this are a pricing risk on volatile pairs. */
  async findStale(maxAgeMinutes = 180) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const currencies = await this.prisma.currency.findMany({ where: { isActive: true, isBase: false } });

    const stale: string[] = [];
    for (const currency of currencies) {
      const latest = await this.prisma.fxRate.findFirst({
        where: { baseCurrency: this.baseCurrency, quoteCurrency: currency.code, isActive: true },
        orderBy: { effectiveAt: 'desc' },
      });
      if (!latest || latest.effectiveAt < cutoff) stale.push(currency.code);
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
