'use client';

import type { Brand } from '@/lib/brands';
import { useT } from '@/lib/i18n';
import { SECTIONS, sectionOf } from '@/lib/sections';
import BrandTile, { BrandTileSkeleton } from './BrandTile';

/**
 * Text as a search compares it: lower case, Arabic letter variants folded
 * (أ إ آ → ا, ة → ه, ى → ي), short vowels and the stretch mark dropped,
 * Arabic digits as Western ones, spaces collapsed.
 */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Brands in a section that match every word typed, in any order, in the
 * brand's name or any of its products' names (both languages) or SKUs:
 * "ببجي 60", "60 pubg" and "شدة ببجى" all find PUBG 60 UC.
 */
export function filterBrands(brands: Brand[], sectionId: string | null, search: string): Brand[] {
  const words = norm(search).split(' ').filter(Boolean);
  return brands.filter((b) => {
    if (sectionId && sectionOf(b).id !== sectionId) return false;
    if (!words.length) return true;
    const text = norm([b.title, ...b.products.flatMap((p) => [p.nameAr, p.nameEn, p.sku])].join(' '));
    return words.every((w) => text.includes(w));
  });
}

/** Section tabs: horizontally scrollable on phones, only sections that have brands. */
export function SectionTabs({
  brands,
  value,
  onChange,
}: {
  brands: Brand[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const t = useT();
  const present = new Set(brands.map((b) => sectionOf(b).id));
  const tabs = [{ id: null as string | null, label: t('الكل') }].concat(
    SECTIONS.filter((s) => present.has(s.id)).map((s) => ({ id: s.id, label: t(s.label) })),
  );

  return (
    <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
      <div role="tablist" aria-label={t('الأقسام')} className="flex w-max gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id ?? 'all'}
            role="tab"
            aria-selected={value === tab.id}
            onClick={() => onChange(tab.id)}
            className="chip"
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BrandGrid({ brands, loading }: { brands: Brand[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
      {loading
        ? Array.from({ length: 12 }).map((_, i) => <BrandTileSkeleton key={i} />)
        : brands.map((b) => <BrandTile key={b.key} brand={b} size="sm" />)}
    </div>
  );
}
