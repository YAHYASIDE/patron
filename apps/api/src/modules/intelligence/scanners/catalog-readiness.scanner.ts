import { Injectable } from '@nestjs/common';
import { DeliveryMode, ProductType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { PricingService } from '../../catalog/pricing.service';
import { DiscoveryInput, Scanner } from '../intelligence.types';

/** Region codes that, as an SKU segment (`GC-APPLE-US-25`), mean the product only works with that region's account. */
export const REGION_SEGMENTS = new Set([
  'US', 'UK', 'GB', 'EU', 'NA', 'TR', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'EG', 'MA', 'DZ', 'TN', 'IN', 'BR', 'DE', 'FR',
  'CA', 'AU', 'NZ', 'JP', 'KR', 'MX', 'AR', 'CL', 'CO', 'PE', 'ES', 'IT', 'NL', 'PL', 'CH', 'SE', 'NO', 'DK', 'AT', 'BE',
  'IE', 'PT', 'HK', 'SG', 'ID', 'PH', 'MY', 'TH', 'TW', 'CN', 'RU', 'UA', 'ZA', 'NG',
]);
const SAMPLE = 10;

export interface CatalogProduct {
  id: string;
  sku: string;
  nameAr: string;
  type: ProductType;
  delivery: DeliveryMode;
  prices: Array<{ currencyCode: string; isActive: boolean }>;
  providers: Array<{ isActive: boolean; provider: { isActive: boolean; isHealthy: boolean } }>;
  game: { slug: string; nameAr: string; inputSchema: unknown } | null;
  category: { slug: string };
}
export interface ServedCountry {
  code: string;
  nameAr: string;
  currency: string;
}
export interface RuleRef {
  countryCode: string;
  scope: string;
  ref: string;
}
/** Per currency: can a product without its own price in it still be priced (active currency + live rate)? */
export type CurrencyState = { exists: boolean; active: boolean; hasRate: boolean };

const list = (items: string[]) => items.slice(0, SAMPLE).join('، ') + (items.length > SAMPLE ? ` (+${items.length - SAMPLE})` : '');

/** The region an SKU is locked to (`GC-APPLE-US-25` → US), else null. Never the first segment (a type prefix). */
export function skuRegion(sku: string): string | null {
  const parts = sku.toUpperCase().split('-');
  for (let i = 1; i < parts.length; i++) if (REGION_SEGMENTS.has(parts[i])) return parts[i];
  return null;
}

/** The storefront's brand key for a product without a game: the SKU without its last segment. */
export const brandKeyOf = (sku: string) => sku.toLowerCase().split('-').slice(0, -1).join('-') || sku.toLowerCase();

/** AUTO_PROVIDER products with no active route to an active, healthy provider: a paid order would fail. */
export function noProviderFindings(products: CatalogProduct[]): DiscoveryInput[] {
  return products
    .filter((p) => p.delivery === 'AUTO_PROVIDER')
    .filter((p) => !p.providers.some((r) => r.isActive && r.provider.isActive && r.provider.isHealthy))
    .map((p): DiscoveryInput => ({
      fingerprint: `catalog.no-provider:${p.sku}`,
      kind: 'catalog',
      title: `منتج آلي بلا مزوّد جاهز: ${p.nameAr}`,
      description: `المنتج ${p.sku} معروض ويُسلَّم عبر مزوّد آلي، لكن لا يوجد له مسار مفعّل إلى مزوّد مفعّل وسليم.`,
      evidence: [{ type: 'db', ref: `products:${p.sku}`, detail: `${p.providers.length} مسار(ات) مزوّد، لا شيء جاهز` }],
      confidence: 90,
      verified: true,
      severity: 'HIGH',
      impact: 'الزبون يدفع ثم يفشل التسليم الآلي، فيحتاج الطلب إلى تدخل يدوي أو استرجاع.',
      proposal: 'فعّل مزوّدًا سليمًا لهذا المنتج، أو حوّل طريقة التسليم إلى يدوي، أو أخفِ المنتج مؤقتًا.',
    }));
}

/**
 * For each currency an enabled country pays in: if the currency is off, or has
 * no live exchange rate, every product without its own price in it cannot be
 * quoted there. One finding per currency.
 */
export function noPriceFindings(
  products: CatalogProduct[],
  countries: ServedCountry[],
  currencies: Map<string, CurrencyState>,
): DiscoveryInput[] {
  const byCurrency = new Map<string, ServedCountry[]>();
  for (const c of countries) byCurrency.set(c.currency, [...(byCurrency.get(c.currency) ?? []), c]);

  const out: DiscoveryInput[] = [];
  for (const [code, served] of byCurrency) {
    const state = currencies.get(code) ?? { exists: false, active: false, hasRate: false };
    const usable = state.exists && state.active;
    if (usable && state.hasRate) continue;
    const missing = products.filter((p) => !usable || !p.prices.some((x) => x.currencyCode === code && x.isActive));
    if (!missing.length) continue;
    const why = !state.exists ? 'العملة غير مضافة' : !state.active ? 'العملة غير مفعّلة' : 'لا يوجد سعر صرف ساري لها';
    out.push({
      fingerprint: `catalog.no-price:${code}`,
      kind: 'catalog',
      title: `${missing.length} منتج بلا سعر بعملة ${code}`,
      description: `الدول ${list(served.map((c) => `${c.nameAr} (${c.code})`))} تدفع بـ ${code}، و${why}. هذه المنتجات ليس لها سعر خاص بها فيها: ${list(missing.map((p) => p.sku))}.`,
      evidence: [
        { type: 'db', ref: `currencies:${code}`, detail: why },
        { type: 'db', ref: 'products', detail: list(missing.map((p) => p.sku)) },
      ],
      confidence: 85,
      verified: true,
      severity: 'HIGH',
      impact: `زبائن ${served.map((c) => c.code).join('/')} لا يستطيعون شراء هذه المنتجات بعملتهم.`,
      proposal: usable
        ? `أضف سعر صرف لـ ${code} في صفحة العملات، أو أسعارًا خاصة بها للمنتجات.`
        : `فعّل العملة ${code} وأضف سعر صرفها في صفحة العملات.`,
    });
  }
  return out;
}

const hasInputs = (schema: unknown) => Array.isArray(schema) && schema.some((f) => f && typeof f === 'object' && 'key' in f);

/** Game top-ups need the player's account (ID, server…): without an input form the order cannot be fulfilled. */
export function missingInputFindings(products: CatalogProduct[]): DiscoveryInput[] {
  const groups = new Map<string, { name: string; skus: string[] }>();
  for (const p of products) {
    if (p.type !== 'GAME_TOPUP' || hasInputs(p.game?.inputSchema)) continue;
    const key = p.game?.slug ?? p.sku.toLowerCase();
    const g = groups.get(key) ?? { name: p.game?.nameAr ?? p.nameAr, skus: [] };
    g.skus.push(p.sku);
    groups.set(key, g);
  }
  return [...groups].map(([key, g]): DiscoveryInput => ({
    fingerprint: `catalog.missing-inputs:${key}`,
    kind: 'catalog',
    title: `شحن بلا حقول حساب: ${g.name}`,
    description: `منتجات شحن لا تطلب من الزبون معرّف حسابه (لا يوجد نموذج حقول): ${list(g.skus)}.`,
    evidence: [{ type: 'db', ref: `games:${key}`, detail: 'inputSchema فارغ أو غير موجود' }],
    confidence: 80,
    verified: true,
    severity: 'MEDIUM',
    impact: 'لا نعرف أي حساب نشحن، فيتأخر التسليم أو يذهب الشحن لحساب خاطئ.',
    proposal: 'أضف حقول الحساب (المعرّف، الخادم…) للعبة في الكتالوج، أو اربط المنتجات بالعبة الصحيحة.',
  }));
}

/**
 * Region-locked SKUs (a `-US-` gift card) sold while an enabled country has no
 * market rule saying whether it works there. One finding per brand.
 */
export function regionLockedFindings(products: CatalogProduct[], countries: ServedCountry[], rules: RuleRef[]): DiscoveryInput[] {
  if (!countries.length) return [];
  const groups = new Map<string, { region: string; skus: string[]; missing: Set<string> }>();
  for (const p of products) {
    const region = skuRegion(p.sku);
    if (!region) continue;
    const brand = brandKeyOf(p.sku);
    const refs = {
      product: [p.sku.toLowerCase()],
      brand: [brand, p.game?.slug].filter((r): r is string => !!r),
      category: [p.category.slug],
    };
    const covered = (code: string) =>
      rules.some((r) => r.countryCode === code && (refs[r.scope as keyof typeof refs] ?? []).includes(r.ref.toLowerCase()));
    const missing = countries.filter((c) => c.code !== region && !covered(c.code)).map((c) => c.code);
    if (!missing.length) continue;
    const g = groups.get(brand) ?? { region, skus: [], missing: new Set<string>() };
    g.skus.push(p.sku);
    missing.forEach((m) => g.missing.add(m));
    groups.set(brand, g);
  }
  return [...groups].map(([brand, g]): DiscoveryInput => ({
    fingerprint: `catalog.region-locked:${brand}`,
    kind: 'catalog',
    title: `منتج مقيد بمنطقة ${g.region} بلا قاعدة سوق: ${brand}`,
    description: `هذه المنتجات تعمل غالبًا بحساب من ${g.region} فقط: ${list(g.skus)}. لا توجد قاعدة توفّر لها في: ${[...g.missing].sort().join('، ')}.`,
    evidence: [{ type: 'db', ref: `products:${brand}`, detail: `مقطع المنطقة ${g.region} في رمز المنتج` }],
    confidence: 70,
    verified: false,
    severity: 'MEDIUM',
    impact: 'قد يشتري زبون بطاقة لا تعمل في بلده، فيطلب استرجاعًا.',
    proposal: 'أضف قاعدة توفّر لكل دولة (متاح / يحتاج حساب منطقة / غير متاح) ليرى الزبون تنبيهًا قبل الشراء.',
  }));
}

/** Active products that cannot be sold as listed (contract: In-app scanners §1). */
@Injectable()
export class CatalogReadinessScanner implements Scanner {
  readonly name = 'catalog-readiness' as const;

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
  ) {}

  async scan(): Promise<DiscoveryInput[]> {
    const [products, countries, rules] = await Promise.all([
      this.prisma.product.findMany({
        where: { deletedAt: null, isActive: true },
        select: {
          id: true, sku: true, nameAr: true, type: true, delivery: true,
          prices: { select: { currencyCode: true, isActive: true } },
          providers: { select: { isActive: true, provider: { select: { isActive: true, isHealthy: true } } } },
          game: { select: { slug: true, nameAr: true, inputSchema: true } },
          category: { select: { slug: true } },
        },
        orderBy: { sku: 'asc' },
      }),
      this.prisma.marketCountry.findMany({ where: { enabled: true }, select: { code: true, nameAr: true, currency: true }, orderBy: { code: 'asc' } }),
      this.prisma.productMarketRule.findMany({ where: { status: { not: 'REJECTED' } }, select: { countryCode: true, scope: true, ref: true } }),
    ]);
    const currencies = await this.currencyStates([...new Set(countries.map((c) => c.currency))]);
    return [
      ...noProviderFindings(products),
      ...noPriceFindings(products, countries, currencies),
      ...missingInputFindings(products),
      ...regionLockedFindings(products, countries, rules),
    ];
  }

  private async currencyStates(codes: string[]) {
    const rows = await this.prisma.currency.findMany({ where: { code: { in: codes } }, select: { code: true, isActive: true } });
    const states = new Map<string, CurrencyState>();
    for (const code of codes) {
      const row = rows.find((r) => r.code === code);
      let hasRate = false;
      if (row) {
        try {
          await this.pricing.getRate(code);
          hasRate = true;
        } catch {
          hasRate = false;
        }
      }
      states.set(code, { exists: !!row, active: !!row?.isActive, hasRate });
    }
    return states;
  }
}
