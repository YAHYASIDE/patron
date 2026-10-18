'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog } from '@/lib/brands';
import { bySection, topBrands } from '@/lib/sections';
import BrandTile, { BrandTileSkeleton } from '@/components/BrandTile';
import { SearchIcon } from '@/components/icons';

/** Tiles a section column shows before "عرض الكل". */
const PER_SECTION = 8;

export default function HomePage() {
  const router = useRouter();
  const currency = useCurrency();
  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const [q, setQ] = useState('');

  const top = topBrands(brands);
  const sections = bySection(brands);

  return (
    <div className="pb-16">
      {/* hero: what this is, and the fastest way in (search) */}
      <section className="border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
        <div className="mx-auto max-w-page px-4 py-6 md:py-10">
          <h1 className="text-2xl font-extrabold leading-[1.25] md:text-4xl">
            اشتراكاتك وشحن ألعابك <span className="text-teal">في مكان واحد</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted md:text-[15px]">
            ادفع بالتحويل (بنكيلي، مصرفي، سداد) واستلم طلبك في صفحة طلباتك.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              router.push(q.trim() ? `/products?q=${encodeURIComponent(q.trim())}` : '/products');
            }}
            className="surface-2 mt-5 flex max-w-xl items-center gap-2 rounded-2xl p-1.5 ps-4"
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

      {/* the brands the owner wants seen first, in their order */}
      <section className="mx-auto max-w-page px-4 pt-7">
        <h2 className="text-xl font-extrabold">الأكثر طلبًا</h2>
        <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-5 md:grid-cols-7">
          {loading
            ? Array.from({ length: 14 }).map((_, i) => <BrandTileSkeleton key={i} />)
            : top.map((b) => <BrandTile key={b.key} brand={b} size="sm" />)}
        </div>
      </section>

      {/* everything else, one column per section */}
      <div className="mx-auto mt-10 grid max-w-page items-start gap-4 px-4 lg:grid-cols-2">
        {sections.map(({ section, brands: list }) => (
          <section key={section.id} className="surface rounded-2xl p-4 shadow-card sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-extrabold">{section.label}</h2>
              {list.length > PER_SECTION && (
                <Link
                  href={`/products?s=${section.id}`}
                  className="text-sm font-bold text-teal hover:underline"
                >
                  عرض الكل ({list.length})
                </Link>
              )}
            </div>
            <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4">
              {list.slice(0, PER_SECTION).map((b) => (
                <BrandTile key={b.key} brand={b} size="sm" />
              ))}
            </div>
          </section>
        ))}
      </div>

      {!loading && !error && brands.length === 0 && (
        <div className="mx-auto mt-8 max-w-page px-4">
          <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-muted">
            لا توجد منتجات متاحة بعد.
          </div>
        </div>
      )}
    </div>
  );
}
