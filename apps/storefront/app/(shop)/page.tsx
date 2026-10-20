'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog } from '@/lib/brands';
import { useT } from '@/lib/i18n';
import { bySection, topBrands } from '@/lib/sections';
import { noteCatalog } from '@/lib/fresh';
import { useRecent } from '@/lib/recent';
import BrandTile, { BrandTileSkeleton } from '@/components/BrandTile';
import BrandRow, { brandsByKeys, useBestSellers } from '@/components/BrandRow';
import SearchSuggest from '@/components/SearchSuggest';
import StoreStats from '@/components/StoreStats';
import { HistoryIcon, TrendIcon } from '@/components/discovery-icons';
import Banners from '@/components/Banners';

/** Tiles a section column shows before "عرض الكل". */
const PER_SECTION = 8;

export default function HomePage() {
  const router = useRouter();
  const t = useT();
  const currency = useCurrency();
  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const [q, setQ] = useState('');
  const recent = brandsByKeys(brands, useRecent());
  const best = useBestSellers(brands, products);

  useEffect(() => noteCatalog(brands), [brands]);

  const top = topBrands(brands);
  const sections = bySection(brands);

  return (
    <div className="pb-16">
      {/* hero: what this is, and the fastest way in (search) */}
      <section className="border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
        <div className="mx-auto max-w-page px-4 py-6 md:py-10">
          <h1 className="text-2xl font-extrabold leading-[1.25] md:text-4xl">
            {t('اشتراكاتك وشحن ألعابك')} <span className="text-teal">{t('في مكان واحد')}</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted md:text-[15px]">
            {t('ادفع بالتحويل (بنكيلي، مصرفي، سداد) واستلم طلبك في صفحة طلباتك.')}
          </p>
          <SearchSuggest
            brands={brands}
            value={q}
            onChange={setQ}
            onSubmit={(v) => router.push(v ? `/products?q=${encodeURIComponent(v)}` : '/products')}
            placeholder={t('عن ماذا تبحث؟')}
            className="surface-2 mt-5 flex max-w-xl items-center gap-2 rounded-2xl p-1.5 ps-4"
            button={
              <button type="submit" className="btn-brand flex-none rounded-xl px-4 py-2.5 text-sm font-bold min-[360px]:px-5">
                {t('بحث')}
              </button>
            }
          />
          <StoreStats />
        </div>
      </section>

      <Banners />

      {error && (
        <div className="mx-auto mt-6 max-w-page px-4">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
            {error}
            <button onClick={reload} className="font-bold underline">
              {t('إعادة المحاولة')}
            </button>
          </div>
        </div>
      )}

      {/* the brands the owner wants seen first, in their order */}
      <section className="mx-auto max-w-page px-4 pt-7">
        <h2 className="text-xl font-extrabold">{t('الأكثر طلبًا')}</h2>
        <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-5 md:grid-cols-7">
          {loading
            ? Array.from({ length: 14 }).map((_, i) => <BrandTileSkeleton key={i} />)
            : top.map((b) => <BrandTile key={b.key} brand={b} size="sm" />)}
        </div>
      </section>

      {/* where the visitor left off, then what sells: below the owner's list, so
          rows that arrive after their own request never push it down */}
      <BrandRow title={t('شاهدتها مؤخرًا')} icon={<HistoryIcon size={20} />} brands={recent} />
      <BrandRow title={t('الأكثر مبيعًا هذا الشهر')} icon={<TrendIcon size={20} />} brands={best} />

      {/* everything else, one column per section */}
      <div className="mx-auto mt-10 grid max-w-page items-start gap-4 px-4 lg:grid-cols-2">
        {loading &&
          Array.from({ length: 4 }).map((_, i) => (
            <section key={i} aria-hidden className="surface rounded-2xl p-4 shadow-card sm:p-5">
              <div className="h-6 w-1/3 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
              <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4">
                {Array.from({ length: PER_SECTION }).map((__, j) => (
                  <BrandTileSkeleton key={j} />
                ))}
              </div>
            </section>
          ))}
        {sections.map(({ section, brands: list }) => (
          <section key={section.id} className="surface rounded-2xl p-4 shadow-card sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-extrabold">{t(section.label)}</h2>
              {list.length > PER_SECTION && (
                <Link
                  href={`/products?s=${section.id}`}
                  className="text-sm font-bold text-teal hover:underline"
                >
                  {t('عرض الكل ({n})', { n: list.length })}
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
            {t('لا توجد منتجات متاحة بعد.')}
          </div>
        </div>
      )}
    </div>
  );
}
