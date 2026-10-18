'use client';

import { useMemo } from 'react';
import type { Brand } from '@/lib/brands';
import type { Category } from '@/lib/types';
import BrandTile, { BrandTileSkeleton } from './BrandTile';

const norm = (s: string) => s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').trim();

/** Brands whose name, or any of whose denominations, matches the search. */
export function filterBrands(brands: Brand[], categoryId: string | null, search: string): Brand[] {
  const q = norm(search);
  return brands.filter(
    (b) =>
      (!categoryId || b.categoryId === categoryId) &&
      (!q ||
        norm(b.title).includes(q) ||
        b.products.some((p) => norm(p.nameAr).includes(q) || norm(p.nameEn).includes(q))),
  );
}

/** Category tabs: horizontally scrollable on phones, only categories that have brands. */
export function CategoryTabs({
  categories,
  brands,
  value,
  onChange,
}: {
  categories: Category[];
  brands: Brand[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const present = useMemo(() => new Set(brands.map((b) => b.categoryId)), [brands]);
  const tabs = [{ id: null as string | null, label: 'الكل' }].concat(
    categories.filter((c) => present.has(c.id)).map((c) => ({ id: c.id, label: c.nameAr || c.nameEn })),
  );

  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div role="tablist" className="flex w-max gap-2">
        {tabs.map((t) => (
          <button
            key={t.id ?? 'all'}
            role="tab"
            aria-selected={value === t.id}
            onClick={() => onChange(t.id)}
            className={
              'whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ' +
              (value === t.id
                ? 'bg-teal text-white'
                : 'surface text-muted hover:border-teal hover:text-[rgb(var(--text))]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function BrandGrid({ brands, loading }: { brands: Brand[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {loading
        ? Array.from({ length: 12 }).map((_, i) => <BrandTileSkeleton key={i} />)
        : brands.map((b) => <BrandTile key={b.key} brand={b} />)}
    </div>
  );
}
