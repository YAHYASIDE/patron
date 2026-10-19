'use client';

import type { Brand } from '@/lib/brands';
import { useT } from '@/lib/i18n';
import { SECTIONS, sectionOf } from '@/lib/sections';
import BrandTile, { BrandTileSkeleton } from './BrandTile';

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();

/** Brands in a section (or all), whose name or any denomination matches the search. */
export function filterBrands(brands: Brand[], sectionId: string | null, search: string): Brand[] {
  const q = norm(search);
  return brands.filter(
    (b) =>
      (!sectionId || sectionOf(b).id === sectionId) &&
      (!q ||
        norm(b.title).includes(q) ||
        b.products.some((p) => norm(p.nameAr).includes(q) || norm(p.nameEn).includes(q))),
  );
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
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div role="tablist" className="flex w-max gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id ?? 'all'}
            role="tab"
            aria-selected={value === tab.id}
            onClick={() => onChange(tab.id)}
            className={
              'whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ' +
              (value === tab.id
                ? 'bg-teal text-white'
                : 'surface text-muted hover:border-teal hover:text-[rgb(var(--text))]')
            }
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
