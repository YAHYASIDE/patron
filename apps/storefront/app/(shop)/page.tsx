'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { catalog } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog } from '@/lib/brands';
import type { Category } from '@/lib/types';
import BrandTile, { BrandTileSkeleton } from '@/components/BrandTile';
import BrandGrid, { CategoryTabs, filterBrands } from '@/components/BrandGrid';
import { BoltIcon, SearchIcon } from '@/components/icons';

export default function HomePage() {
  const router = useRouter();
  const currency = useCurrency();
  const cats = useFetch<Category[]>(() => catalog.categories(), []);
  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const [tab, setTab] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const featured = brands.filter((b) => b.featured);
  const popular = (featured.length >= 4 ? featured : brands).slice(0, 12);
  const mosaic = popular.slice(0, 6);

  return (
    <div>
      {/* hero: what this is, and the fastest way in (search) */}
      <section className="border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
        <div className="mx-auto grid max-w-page items-center gap-8 px-4 py-8 md:py-12 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/10 px-3 py-1 text-xs font-bold text-teal">
              <BoltIcon size={13} /> ادفع بالتحويل واستلم في طلباتك
            </span>
            <h1 className="mt-4 text-3xl font-extrabold leading-[1.2] md:text-5xl">
              شحن الألعاب والبطاقات
              <span className="text-teal"> ورصيد الهاتف</span>
            </h1>
            <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted">
              ببجي، فري فاير، آيتونز، نتفلكس، ماتل وموريتل. أسعار بالأوقية بلا رسوم مخفية.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                router.push(q.trim() ? `/products?q=${encodeURIComponent(q.trim())}` : '/products');
              }}
              className="surface-2 mt-6 flex max-w-lg items-center gap-2 rounded-2xl p-1.5 ps-4"
            >
              <SearchIcon size={18} className="flex-none text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="عن ماذا تبحث؟"
                aria-label="بحث"
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
              <button type="submit" className="btn-brand rounded-xl px-5 py-2.5 text-sm font-bold">
                بحث
              </button>
            </form>
          </div>

          {/* the actual top brands, as tiles you can tap */}
          <div className="hidden grid-cols-3 gap-3 lg:grid">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => <BrandTileSkeleton key={i} />)
              : mosaic.map((b) => <BrandTile key={b.key} brand={b} />)}
          </div>
        </div>
      </section>

      {error && (
        <div className="mx-auto mt-6 max-w-page px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error}
            <button onClick={reload} className="font-bold underline">
              إعادة المحاولة
            </button>
          </div>
        </div>
      )}

      {/* most wanted: a swipeable row on phones (the hero shows them on desktop) */}
      <section className="mx-auto max-w-page px-4 pt-8 lg:hidden">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-extrabold">الأكثر طلبًا</h2>
          <Link href="/products" className="text-sm font-bold text-teal hover:underline">
            عرض الكل
          </Link>
        </div>
        <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max snap-x snap-mandatory gap-3">
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="w-36 sm:w-44">
                    <BrandTileSkeleton />
                  </div>
                ))
              : popular.map((b) => <BrandTile key={b.key} brand={b} size="lg" />)}
          </div>
        </div>
      </section>

      {/* everything, by section */}
      <section className="mx-auto max-w-page px-4 pb-16 pt-8">
        <h2 className="text-xl font-extrabold">تسوّق حسب القسم</h2>
        <div className="mt-4">
          <CategoryTabs categories={cats.data ?? []} brands={brands} value={tab} onChange={setTab} />
        </div>
        <div className="mt-6">
          <BrandGrid brands={filterBrands(brands, tab, '')} loading={loading} />
        </div>
        {!loading && !error && brands.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-muted">
            لا توجد منتجات متاحة بعد.
          </div>
        )}
      </section>
    </div>
  );
}
