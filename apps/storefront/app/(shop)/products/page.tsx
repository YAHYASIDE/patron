'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { catalog } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog } from '@/lib/brands';
import type { Category } from '@/lib/types';
import BrandGrid, { CategoryTabs, filterBrands } from '@/components/BrandGrid';
import { SearchIcon } from '@/components/icons';

function ProductsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const categoryId = params.get('categoryId');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const currency = useCurrency();

  const cats = useFetch<Category[]>(() => catalog.categories(), []);
  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const shown = filterBrands(brands, categoryId, search);
  const activeCat = cats.data?.find((c) => c.id === categoryId);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">
        {activeCat ? activeCat.nameAr || activeCat.nameEn : 'كل المنتجات'}
      </h1>

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
        <CategoryTabs
          categories={cats.data ?? []}
          brands={brands}
          value={categoryId}
          onChange={(id) =>
            router.replace(id ? `/products?categoryId=${id}` : '/products', { scroll: false })
          }
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
