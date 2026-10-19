'use client';

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog, type Brand } from '@/lib/brands';
import { useLang, useT, type Lang } from '@/lib/i18n';
import { SECTIONS } from '@/lib/sections';
import BrandGrid, { SectionTabs, filterBrands } from '@/components/BrandGrid';
import { SearchIcon } from '@/components/icons';

const SORTS = [
  { id: 'best', label: 'الأنسب' },
  { id: 'cheap', label: 'الأرخص' },
  { id: 'dear', label: 'الأغلى' },
  { id: 'name', label: 'الاسم' },
] as const;
type SortId = (typeof SORTS)[number]['id'];

// a brand's price is its cheapest denomination ("from …")
const from = (b: Brand) => parseFloat(b.products[0]?.sellPrice ?? '0');

function arrange(list: Brand[], sort: SortId, offers: boolean, lang: Lang): Brand[] {
  const out = offers ? list.filter((b) => b.maxDiscount > 0) : list.slice();
  if (sort === 'cheap') out.sort((a, b) => from(a) - from(b));
  if (sort === 'dear') out.sort((a, b) => from(b) - from(a));
  if (sort === 'name') out.sort((a, b) => a.title.localeCompare(b.title, lang));
  return out;
}

const chip = (on: boolean) =>
  `flex-none rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
    on ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]'
  }`;

function ProductsInner() {
  const t = useT();
  const lang = useLang();
  const params = useSearchParams();
  const router = useRouter();
  const sectionId = params.get('s');
  const [search, setSearch] = useState(params.get('q') ?? '');
  const currency = useCurrency();
  const [sort, setSort] = useState<SortId>('best');
  const [offers, setOffers] = useState(params.get('offers') === '1');

  const { products, error, loading, reload } = useCatalog(currency);
  const brands = useMemo(() => (products ? groupBrands(products) : []), [products]);
  const shown = arrange(filterBrands(brands, sectionId, search), sort, offers, lang);
  const hasOffers = brands.some((b) => b.maxDiscount > 0);
  const active = SECTIONS.find((x) => x.id === sectionId);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{active ? t(active.label) : t('كل المنتجات')}</h1>

      <label className="surface mt-5 flex items-center gap-2 rounded-xl px-3.5 py-3">
        <SearchIcon size={18} className="text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('ابحث: ببجي، آيتونز، نتفلكس، ماتل…')}
          aria-label={t('بحث')}
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

      <div
        className="-mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label={t('ترتيب')}
      >
        {SORTS.map((o) => (
          <button
            key={o.id}
            onClick={() => setSort(o.id)}
            aria-pressed={sort === o.id}
            className={chip(sort === o.id)}
          >
            {t(o.label)}
          </button>
        ))}
        {hasOffers && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px flex-none bg-[rgb(var(--line))]" />
            <button onClick={() => setOffers((v) => !v)} aria-pressed={offers} className={chip(offers)}>
              {t('عروض وتخفيضات')}
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
          <button onClick={reload} className="font-bold underline">
            {t('إعادة المحاولة')}
          </button>
        </div>
      )}

      <div className="mt-6">
        <BrandGrid brands={shown} loading={loading} />
      </div>

      {!loading && !error && shown.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-muted">
          {offers && !search
            ? t('لا توجد عروض في هذا القسم الآن.')
            : t('لا يوجد ما يطابق «{search}». جرّب اسمًا آخر أو اختر قسمًا.', { search })}
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-page px-4 py-16 text-center text-muted">{t('جارٍ التحميل…')}</div>
      }
    >
      <ProductsInner />
    </Suspense>
  );
}
