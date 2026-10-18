'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog } from '@/lib/brands';
import { SECTIONS } from '@/lib/sections';
import BrandGrid, { SectionTabs, filterBrands } from '@/components/BrandGrid';
import { SearchIcon } from '@/components/icons';

function ProductsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sectionId = params.get('s');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const currency = useCurrency();

  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const shown = filterBrands(brands, sectionId, search);
  const active = SECTIONS.find((x) => x.id === sectionId);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{active ? active.label : 'كل المنتجات'}</h1>

      <label className="surface mt-5 flex items-center gap-2 rounded-xl px-3.5 py-3">
        <SearchIcon size={18} className="text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث: ببجي، آيتونز، نتفلكس، ماتل…"
          aria-label="بحث"
          className="w-full bg-transparent text-[15px] outline-none"
        />
      </label>

      <div className="mt-4">
        <SectionTabs
          brands={brands}
          value={sectionId}
          onChange={(id) => router.replace(id ? `/products?s=${id}` : '/products', { scroll: false })}
        />
      </div>

      {error && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
          <button onClick={reload} className="font-bold underline">
            إعادة المحاولة
          </button>
        </div>
      )}

      <div className="mt-6">
        <BrandGrid brands={shown} loading={loading} />
      </div>

      {!loading && !error && shown.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-muted">
          لا يوجد ما يطابق «{search}». جرّب اسمًا آخر أو اختر قسمًا.
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={<div className="mx-auto max-w-page px-4 py-16 text-center text-muted">جارٍ التحميل…</div>}
    >
      <ProductsInner />
    </Suspense>
  );
}
