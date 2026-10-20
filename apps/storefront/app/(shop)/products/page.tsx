'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCurrency } from '@/lib/currency';
import { groupBrands, useCatalog, type Brand } from '@/lib/brands';
import { useLang, useT, type Lang } from '@/lib/i18n';
import { SECTIONS, topBrands } from '@/lib/sections';
import { noteCatalog } from '@/lib/fresh';
import BrandGrid, { SectionTabs, filterBrands } from '@/components/BrandGrid';
import SearchSuggest from '@/components/SearchSuggest';
import SuggestButton from '@/components/SuggestProduct';
import BrandTile from '@/components/BrandTile';
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

  useEffect(() => noteCatalog(brands), [brands]);

  // keep what was typed in the address (?q=), so Back from a brand returns to the same results
  useEffect(() => {
    const timer = setTimeout(() => {
      const url = new URL(window.location.href);
      const q = search.trim();
      if ((url.searchParams.get('q') ?? '') === q) return;
      if (q) url.searchParams.set('q', q);
      else url.searchParams.delete('q');
      window.history.replaceState(window.history.state, '', url);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{active ? t(active.label) : t('كل المنتجات')}</h1>

      {/* the grid filters as you type; the suggestions jump straight to a brand */}
      <SearchSuggest
        brands={brands}
        value={search}
        onChange={setSearch}
        placeholder={t('ابحث: ببجي، آيتونز، نتفلكس، ماتل…')}
        popular={topBrands(brands)}
        className="surface mt-5 flex min-h-12 items-center gap-2 rounded-2xl py-1 pe-1.5 ps-4 shadow-card focus-within:border-teal"
      />

      <div className="mt-4">
        <SectionTabs
          brands={brands}
          value={sectionId}
          onChange={(id) => {
            const q = search.trim();
            const qs = new URLSearchParams();
            if (id) qs.set('s', id);
            if (q) qs.set('q', q);
            router.replace(qs.toString() ? `/products?${qs}` : '/products', { scroll: false });
          }}
        />
      </div>

      <div
        className="no-scrollbar -mx-4 mt-2.5 flex items-center gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label={t('ترتيب')}
      >
        {SORTS.map((o) => (
          <button
            key={o.id}
            onClick={() => setSort(o.id)}
            aria-pressed={sort === o.id}
            className="chip"
          >
            {t(o.label)}
          </button>
        ))}
        {hasOffers && (
          <>
            <span aria-hidden className="mx-1 h-5 w-px flex-none bg-[rgb(var(--line))]" />
            <button onClick={() => setOffers((v) => !v)} aria-pressed={offers} className="chip">
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

      {/* how many brands match, so a narrowed list is never mistaken for the whole shop */}
      <p className="mt-4 min-h-5 text-xs font-semibold text-muted" aria-live="polite">
        {!loading && !error && shown.length > 0 && (search.trim() || sectionId || offers)
          ? t('النتائج: {n}', { n: shown.length })
          : null}
      </p>

      <div className="mt-2">
        <BrandGrid brands={shown} loading={loading} />
      </div>

      {!loading && !error && shown.length === 0 && (
        <div className="surface mt-2 rounded-2xl p-6 text-center shadow-card sm:p-10">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal/10 text-teal">
            <SearchIcon size={26} />
          </div>
          <p className="mt-4 font-extrabold">
            {offers && !search
              ? t('لا توجد عروض في هذا القسم الآن.')
              : search.trim()
                ? t('لا نتائج لـ «{search}»', { search: search.trim() })
                : t('لا يوجد ما يطابق «{search}». جرّب اسمًا آخر أو اختر قسمًا.', { search })}
          </p>
          {search.trim() && (
            <p className="mt-1 text-sm text-muted">{t('تأكد من الكتابة أو جرّب اسمًا أقصر، بالعربية أو الإنجليزية.')}</p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {search.trim() && (
              <button type="button" onClick={() => setSearch('')} className="btn-quiet">
                {t('مسح البحث')}
              </button>
            )}
            {(sectionId || offers) && (
              <button
                type="button"
                onClick={() => {
                  setOffers(false);
                  router.replace(search.trim() ? `/products?q=${encodeURIComponent(search.trim())}` : '/products', { scroll: false });
                }}
                className="btn-quiet"
              >
                {t('كل الأقسام')}
              </button>
            )}
          </div>
          {search.trim() && (
            <SuggestButton text={search} className="mt-4 block w-full text-sm font-bold text-teal hover:underline">
              {t('لم تجد ما تبحث عنه؟ اقترح علينا')}
            </SuggestButton>
          )}
        </div>
      )}

      {/* a dead end still leads somewhere: the brands people buy most */}
      {!loading && !error && shown.length === 0 && brands.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-extrabold">{t('الأكثر طلبًا')}</h2>
          <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
            {topBrands(brands)
              .slice(0, 8)
              .map((b) => (
                <BrandTile key={b.key} brand={b} size="sm" />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const t = useT();
  return (
    <Suspense
      fallback={
        // the page's own shape, so nothing jumps when it arrives
        <div className="mx-auto max-w-page px-4 py-8" aria-label={t('جارٍ التحميل…')}>
          <div className="skel h-8 w-40" />
          <div className="skel mt-5 h-12 rounded-2xl" />
          <div className="skel mt-4 h-10 w-3/4 rounded-full" />
          <div className="mt-8">
            <BrandGrid brands={[]} loading />
          </div>
        </div>
      }
    >
      <ProductsInner />
    </Suspense>
  );
}
