import { Injectable } from '@nestjs/common';
import { MarketReviewStatus } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { DiscoveryInput, Scanner } from '../intelligence.types';

/** System setting: after how many days a method or rule needs checking again (contract: 90). */
export const STALE_DAYS_KEY = 'markets.stale_days';
export const DEFAULT_STALE_DAYS = 90;
const DAY_MS = 86_400_000;

export interface StalenessCountry {
  code: string;
  nameAr: string;
  enabled: boolean;
  lastResearchedAt: Date | null;
}
export interface StaleItem {
  countryCode: string;
  label: string;
  status: MarketReviewStatus;
  lastVerifiedAt: Date;
}

export function staleDays(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? n : DEFAULT_STALE_DAYS;
}

/**
 * Research that has aged (contract: In-app scanners §3): one finding per country
 * whose methods or rules were last verified more than `days` ago, and one per
 * enabled country never researched (the same subject the markets module raises
 * for a new country, so the two land on one row).
 */
export function stalenessFindings(
  countries: StalenessCountry[],
  methods: StaleItem[],
  rules: StaleItem[],
  days: number,
): DiscoveryInput[] {
  const out: DiscoveryInput[] = [];
  for (const c of countries) {
    const m = methods.filter((x) => x.countryCode === c.code);
    const r = rules.filter((x) => x.countryCode === c.code);
    if (m.length || r.length) {
      const oldest = [...m, ...r].reduce((a, b) => (a.lastVerifiedAt < b.lastVerifiedAt ? a : b)).lastVerifiedAt;
      const liveMethod = m.some((x) => x.status === 'ACTIVE' || x.status === 'APPROVED');
      out.push({
        fingerprint: `market.stale:${c.code}`,
        kind: 'market',
        title: `معلومات سوق ${c.nameAr} تحتاج إعادة تحقق`,
        description: `${m.length} وسيلة دفع و${r.length} قاعدة منتجات في ${c.code} لم يُتحقق منها منذ أكثر من ${days} يومًا (أقدمها ${oldest.toISOString().slice(0, 10)}). الوسائل: ${m.map((x) => x.label).slice(0, 10).join('، ') || '—'}.`,
        evidence: [
          { type: 'db', ref: `market_payment_methods:${c.code}`, detail: `${m.length} قديمة` },
          { type: 'db', ref: `product_market_rules:${c.code}`, detail: `${r.length} قديمة` },
        ],
        confidence: 90,
        verified: true,
        severity: liveMethod ? 'MEDIUM' : 'LOW',
        impact: 'رسوم أو وسائل تغيرت دون علمنا قد تُعرض على الزبائن.',
        proposal: `أعد البحث عن ${c.code} من المصادر الرسمية (وكيل السوق) وأرسل النتائج؛ القرارات السابقة تبقى كما هي.`,
      });
    }
    if (c.enabled && !c.lastResearchedAt) {
      out.push({
        fingerprint: `market.research-needed:${c.code}`,
        kind: 'market',
        title: `دولة مفعّلة لم يُبحث سوقها: ${c.nameAr}`,
        description: `${c.nameAr} (${c.code}) مفعّلة للزبائن، ولا يوجد بحث مسجّل عن وسائل الدفع وتوفّر المنتجات فيها.`,
        evidence: [{ type: 'db', ref: `market_countries:${c.code}`, detail: 'lastResearchedAt = null' }],
        confidence: 95,
        verified: true,
        severity: 'MEDIUM',
        impact: 'قد نعرض وسائل أو منتجات لا تعمل في هذه الدولة.',
        proposal: `اطلب من وكيل السوق بحث ${c.code} (العملة، وسائل الدفع، توفّر المنتجات) ومراجعة النتائج.`,
      });
    }
  }
  return out;
}

@Injectable()
export class MarketStalenessScanner implements Scanner {
  readonly name = 'market-staleness' as const;

  constructor(private prisma: PrismaService) {}

  async scan(now: Date): Promise<DiscoveryInput[]> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: STALE_DAYS_KEY } });
    const days = staleDays(setting?.value);
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    // a rejected suggestion is settled: its age does not matter
    const where = { status: { not: 'REJECTED' as const }, lastVerifiedAt: { lt: cutoff } };
    const [countries, methods, rules] = await Promise.all([
      this.prisma.marketCountry.findMany({
        select: { code: true, nameAr: true, enabled: true, lastResearchedAt: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.marketPaymentMethod.findMany({ where, select: { countryCode: true, name: true, status: true, lastVerifiedAt: true } }),
      this.prisma.productMarketRule.findMany({ where, select: { countryCode: true, scope: true, ref: true, status: true, lastVerifiedAt: true } }),
    ]);
    return stalenessFindings(
      countries,
      methods.map((m) => ({ countryCode: m.countryCode, label: m.name, status: m.status, lastVerifiedAt: m.lastVerifiedAt })),
      rules.map((r) => ({ countryCode: r.countryCode, label: `${r.scope}:${r.ref}`, status: r.status, lastVerifiedAt: r.lastVerifiedAt })),
      days,
    );
  }
}
