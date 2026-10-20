// Region-locked SKUs in catalog packs (e.g. GC-APPLE-US-25: a US-account gift card) that no market
// rule covers. Customers in Mauritania, Mali, Algeria or Niger may not be able to redeem them, so the
// product should carry an approved ProductMarketRule (REGION_ACCOUNT_REQUIRED) and a store notice.
// One discovery per region; whether a card really fails in a country is research, so verified=false.
import { join } from 'node:path';
import { lineIndex, read, rel, walk } from '../lib/fs.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'region-locked-sku';

const REGIONS = ['US', 'UK', 'GB', 'EU', 'CA', 'AU', 'TR', 'SA', 'AE', 'IN', 'BR', 'JP', 'DE', 'FR', 'MX', 'KR'];
const REGION_IN_SKU = new RegExp(`-(${REGIONS.join('|')})(?:-|$)`);
const SKU = /["']?sku["']?\s*:\s*["']([A-Z0-9][A-Z0-9_-]+)["']/g;

/** Catalog pack sources: files or folders named catalog-pack / catalog-packs. */
const isPack = (p) =>
  /(?:^|\/)catalog[-_]?packs?(?:[-_./]|$)/i.test(p) && /\.(?:[jt]s|json)$/.test(p) && !/\.(?:spec|test)\./.test(p) && !/\/test\//.test(p);

/** Everything a market rule could be declared in: SQL inserts into product_market_rules, rule files. */
function ruleRefs(root) {
  const refs = new Set();
  const sources = [
    ...walk(join(root, 'apps/api/prisma/migrations'), (p) => p.endsWith('.sql')),
    ...walk(join(root, 'apps/api/src/bootstrap'), (p) => /\.[jt]s$/.test(p)),
    ...walk(join(root, 'docs/markets'), (p) => /\.(?:json|[jt]s|md)$/.test(p)),
  ];
  for (const file of sources) {
    const src = read(file);
    for (const stmt of src.matchAll(/INSERT\s+INTO\s+"?product_market_rules"?[\s\S]*?;/gi)) {
      for (const s of stmt[0].matchAll(/'([^']+)'/g)) refs.add(s[1].toUpperCase());
    }
    // { scope: 'product'|'brand', ref: 'GC-APPLE-US-10' } in rule data files
    if (/market[-_]?rules?|productMarketRule/i.test(file + src.slice(0, 2000))) {
      for (const m of src.matchAll(/["']?ref["']?\s*:\s*["']([^"']+)["']/g)) refs.add(m[1].toUpperCase());
    }
  }
  return refs;
}

export function run({ root }) {
  const packs = walk(join(root, 'apps'), (p) => isPack(rel(root, p)));
  if (!packs.length) return [];
  const refs = ruleRefs(root);
  const byRegion = new Map();
  for (const file of packs) {
    const src = read(file);
    const lineOf = lineIndex(src);
    const path = rel(root, file);
    for (const m of src.matchAll(SKU)) {
      const sku = m[1];
      const region = REGION_IN_SKU.exec(sku)?.[1];
      if (!region) continue;
      const brand = sku.slice(0, sku.indexOf(`-${region}`) + region.length + 1); // GC-APPLE-US
      // the whole entry (rest of the line): a pack may carry its own market note
      const entry = src.slice(m.index, src.indexOf('\n', m.index) === -1 ? undefined : src.indexOf('\n', m.index));
      if (refs.has(sku) || refs.has(brand) || /marketRule|marketNote|market_rule/.test(entry)) continue;
      const list = byRegion.get(region) ?? [];
      if (!list.some((x) => x.sku === sku)) list.push({ sku, brand, ref: `${path}:${lineOf(m.index)}` });
      byRegion.set(region, list);
    }
  }
  const out = [];
  for (const [region, list] of byRegion) {
    const brands = [...new Set(list.map((x) => x.brand))];
    // one evidence line per brand: where it starts and every SKU of it
    const evidence = brands.map((brand) => {
      const skus = list.filter((x) => x.brand === brand);
      return { type: 'file', ref: skus[0].ref, detail: skus.map((x) => x.sku).join(', ') };
    });
    out.push(
      discovery(name, region, {
        kind: 'opportunity',
        title: `${list.length} منتجًا مقيّدًا بمنطقة ${region} بلا قاعدة سوق (${brands.length} علامة)`,
        description:
          `منتجات حزمة الكتالوج ${brands.join('، ')} تعمل فقط مع حسابات ${region}، ` +
          'ولا توجد قاعدة ProductMarketRule أو ملاحظة سوق تخصّها، فلا يعرف المتجر هل يعرضها لزبائن موريتانيا ومالي والجزائر والنيجر وبأي تنبيه. ' +
          'هذا تقدير من اسم SKU؛ صلاحيتها في كل دولة تحتاج بحثًا.',
        evidence: evidence.slice(0, 20),
        confidence: 60,
        verified: false,
        severity: 'LOW',
        impact: 'زبون قد يشتري بطاقة لا يستطيع تفعيلها في حسابه، فيطلب استرجاعًا.',
        proposal: `اطلب من market-scout بحث صلاحية بطاقات ${region} لكل دولة، ثم سجّل قواعد REGION_ACCOUNT_REQUIRED (PENDING_REVIEW) ليقرّها المالك.`,
      }),
    );
  }
  return out;
}
