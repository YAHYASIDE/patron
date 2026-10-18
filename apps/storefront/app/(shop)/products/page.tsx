'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { catalog } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { Category, Paginated, Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';
import { SearchIcon } from '@/components/icons';

function SkeletonCard() {
  return (
    <div className="surface overflow-hidden rounded-2xl">
      <div className="aspect-[4/3] animate-pulse bg-[rgb(var(--surface-2))]" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
      </div>
    </div>
  );
}

function ProductsInner() {
  const params = useSearchParams();
  const categoryId = params.get('categoryId') ?? undefined;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const cats = useFetch<Category[]>(() => catalog.categories(), []);
  const res = useFetch<Paginated<Product>>(
    () => catalog.products({ categoryId, search: search || undefined, page, limit: 16 }),
    [categoryId, search, page],
  );

  const activeCat = cats.data?.find((c) => c.id === categoryId);
  const meta = res.data?.meta;

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-extrabold">{activeCat ? activeCat.nameAr || activeCat.nameEn : 'كل المنتجات'}</h1>
        <p className="text-sm text-muted">اختر منتجًا لعرض التفاصيل والشراء.</p>
      </div>

      {/* search */}
      <div className="mt-6 flex items-center gap-2">
        <div className="surface flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5">
          <SearchIcon size={18} className="text-muted" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="ابحث عن منتج أو لعبة…"
            className="w-full bg-transparent text-[15px] outline-none"
          />
        </div>
      </div>

      {/* category chips */}
      {(cats.data?.length ?? 0) > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/products"
            className={
              'rounded-full px-3.5 py-1.5 text-sm font-bold transition ' +
              (!categoryId ? 'bg-teal text-white' : 'surface hover:border-teal hover:text-teal')
            }
          >
            الكل
          </Link>
          {cats.data!.map((c) => (
            <Link
              key={c.id}
              href={`/products?categoryId=${c.id}`}
              className={
                'rounded-full px-3.5 py-1.5 text-sm font-bold transition ' +
                (categoryId === c.id ? 'bg-teal text-white' : 'surface hover:border-teal hover:text-teal')
              }
            >
              {c.nameAr || c.nameEn}
            </Link>
          ))}
        </div>
      )}

      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          تعذّر تحميل المنتجات. حاول مرة أخرى.
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {res.loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : res.data?.data.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>

      {!res.loading && (res.data?.data.length ?? 0) === 0 && !res.error && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          لا توجد نتائج مطابقة.
        </div>
      )}

      {/* pagination */}
      {meta && meta.pages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-40"
          >
            السابق
          </button>
          <span className="text-sm font-bold text-muted tnum">
            {page} / {meta.pages}
          </span>
          <button
            disabled={page >= meta.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-page px-4 py-16 text-center text-muted">جارٍ التحميل…</div>}>
      <ProductsInner />
    </Suspense>
  );
}
