import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UsdtConfigDto } from './dto/usdt.dto';
import { DEFAULT_USDT_CONFIG, USDT_CONFIG_KEY, USDT_NETWORKS, UsdtConfig, normalizeConfig } from './usdt-rules';

/** The owner's USDT terms, kept in `system_settings` under `usdt.config`. */
@Injectable()
export class UsdtConfigService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async get(): Promise<UsdtConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: USDT_CONFIG_KEY } });
    return row ? normalizeConfig(row.value) : { ...DEFAULT_USDT_CONFIG, networks: { ...DEFAULT_USDT_CONFIG.networks } };
  }

  /** Every customer route that starts something new goes through this. */
  async requireEnabled(): Promise<UsdtConfig> {
    const config = await this.get();
    if (!config.enabled) {
      throw new ForbiddenException({ message: 'Buying USDT is not available at the moment', error: 'USDT_DISABLED' });
    }
    return config;
  }

  /** What the store needs to draw the form; nothing at all while the service is off. */
  async publicSummary() {
    const c = await this.get();
    if (!c.enabled) return { enabled: false as const };
    const codes = Object.keys(c.rates);
    const currencies = codes.length
      ? await this.prisma.currency.findMany({ where: { code: { in: codes }, isActive: true }, select: { code: true, decimals: true }, orderBy: { sortOrder: 'asc' } })
      : [];
    return {
      enabled: true as const,
      currencies: currencies.map((cur) => ({ code: cur.code, rate: c.rates[cur.code], decimals: Math.min(4, cur.decimals) })),
      feePercent: c.feePercent,
      feeFixedUsdt: c.feeFixedUsdt,
      minUsdt: c.minUsdt,
      maxUsdt: c.maxUsdt,
      networks: USDT_NETWORKS.filter((n) => c.networks[n]),
      binanceEnabled: c.binanceEnabled,
      expiryMinutes: c.expiryMinutes,
    };
  }

  async update(dto: UsdtConfigDto, actorId: string): Promise<UsdtConfig> {
    const before = await this.get();
    const invalid = (message: string) => new BadRequestException({ message, error: 'USDT_CONFIG_INVALID' });

    const rates: Record<string, string> = {};
    for (const [rawCode, rawRate] of Object.entries(dto.rates ?? {})) {
      const code = rawCode.trim().toUpperCase();
      const rate = typeof rawRate === 'number' ? String(rawRate) : typeof rawRate === 'string' ? rawRate.trim() : '';
      if (!/^[A-Z]{3}$/.test(code)) throw invalid(`Unknown currency code "${rawCode}"`);
      if (rate === '') continue; // an empty box means "not sold in this currency"
      if (!/^\d{1,12}(\.\d{1,6})?$/.test(rate) || new Prisma.Decimal(rate).lte(0)) throw invalid(`The ${code} rate must be a positive number`);
      rates[code] = rate;
    }
    const codes = Object.keys(rates);
    if (codes.length) {
      const known = await this.prisma.currency.findMany({ where: { code: { in: codes } }, select: { code: true } });
      const missing = codes.filter((c) => !known.some((k) => k.code === c));
      if (missing.length) throw invalid(`Unknown currency: ${missing.join(', ')}`);
    }

    const feePercent = new Prisma.Decimal(dto.feePercent);
    if (feePercent.gt(50)) throw invalid('The fee cannot exceed 50%');
    if (new Prisma.Decimal(dto.feeFixedUsdt).gt(1000)) throw invalid('The fixed fee cannot exceed 1000 USDT');
    const min = new Prisma.Decimal(dto.minUsdt);
    const max = new Prisma.Decimal(dto.maxUsdt);
    if (min.lt(1)) throw invalid('The minimum is at least 1 USDT');
    if (max.lt(min)) throw invalid('The maximum must be at least the minimum');
    if (max.gt(1_000_000)) throw invalid('The maximum cannot exceed 1,000,000 USDT');

    const next: UsdtConfig = {
      enabled: dto.enabled,
      rates,
      feePercent: dto.feePercent,
      feeFixedUsdt: dto.feeFixedUsdt,
      minUsdt: dto.minUsdt,
      maxUsdt: dto.maxUsdt,
      networks: { TRC20: dto.networks.TRC20, BEP20: dto.networks.BEP20, ERC20: dto.networks.ERC20 },
      binanceEnabled: dto.binanceEnabled,
      expiryMinutes: dto.expiryMinutes,
    };

    if (next.enabled) {
      // turning it on is the owner's legal call, confirmed every time it goes from off to on
      if (!before.enabled && dto.legalApproval !== true) {
        throw new BadRequestException({
          message: 'Confirm that the owner has the legal approval to sell USDT before switching it on',
          error: 'USDT_LEGAL_ACK_REQUIRED',
        });
      }
      if (!codes.length) throw invalid('Set the USDT rate for at least one currency before switching it on');
      if (!next.binanceEnabled && !USDT_NETWORKS.some((n) => next.networks[n])) {
        throw invalid('Allow at least one network or Binance transfer before switching it on');
      }
    }

    const value = JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: USDT_CONFIG_KEY },
        update: { value },
        create: { key: USDT_CONFIG_KEY, value, group: 'usdt', isPublic: false, description: 'USDT sales: switch, rates, fees, limits, networks' },
      });
      await this.audit.record(tx, {
        actorId,
        action: before.enabled !== next.enabled ? (next.enabled ? 'usdt.config.enable' : 'usdt.config.disable') : 'usdt.config.update',
        entityType: 'SystemSetting',
        entityId: USDT_CONFIG_KEY,
        before,
        after: next,
      });
    });
    return next;
  }
}
