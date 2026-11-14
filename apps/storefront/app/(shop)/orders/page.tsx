'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import { groupBrands, useCatalog } from '@/lib/brands';
import { useCurrency } from '@/lib/currency';
import type { Order } from '@/lib/types';
import { ChevronIcon, SearchIcon } from '@/components/icons';
import { BagIcon } from '@/components/my/icons';
import { ORDER_GROUPS, chip } from '@/components/my/status';
import { day, fold } from '@/components/my/when';
import { useT, useLang } from '@/lib/i18n';

// A customer's whole history in a few pages; filters and search then run on the device.
const PAGE = 100;
const MAX_PAGES = 5;

async function loadAll(): Promise<{ orders: Order[]; truncated: boolean }> {
  const orders: Order[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await shop.orders({ limit: PAGE, cursor });
    orders.push(...page.data);
    if (!page.meta.hasMore || !page.meta.nextCursor) return { orders, truncated: false };
    cursor = page.meta.nextCursor;
  }
  return { orders, truncated: true };
}

/**
 * The brand art for an order line, from the catalogue the shop already holds
 * (no extra request when warm). The orders list carries product names, not
 * ids, so lines are matched by id when present, else by name (the English
 * name is never localised away; the Arabic one is the source in Arabic).
 */
function useArt(): (it: { productId?: string; productNameAr: string; productNameEn: string }) => string | undefined {
  const { products } = useCatalog(useCurrency());
  const map = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of products ? groupBrands(products) : []) {
      if (!b.image) continue;
      for (const p of b.products) for (const k of [p.id, p.nameEn, p.nameAr]) if (k && !m.has(k)) m.set(k, b.image);
    }
    return m;
  }, [products]);
  return (it) => (it.productId && map.get(it.productId)) || map.get(it.productNameEn) || map.get(it.productNameAr);
}

/** An order card's shape while the list loads, so nothing jumps when it arrives. */
function OrderSkeleton() {
  return (
    <div aria-hidden className="surface flex items-center gap-3 rounded-2xl p-3.5 shadow-card">
      <div className="skel h-14 w-14 flex-none rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="skel h-4 w-2/3" />
        <div className="skel h-3 w-1/2" />
        <div className="skel h-3 w-1/3" />
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/orders');
  }, [router]);

  const res = useFetch(loadAll, []);
  const art = useArt();
  const [group, setGroup] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const name = (it: Order['items'][number]) =>
    lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr;

  const all = useMemo(() => res.data?.orders ?? [], [res.data]);
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of ORDER_GROUPS) m[g.id] = all.filter((o) => g.statuses.includes(o.status)).length;
    return m;
  }, [all]);

  const shown = useMemo(() => {
    const statuses = ORDER_GROUPS.find((g) => g.id === group)?.statuses;
    const needle = fold(q);
    return all.filter(
      (o) =>
        (!statuses || statuses.includes(o.status)) &&
        (!needle ||
          fold(o.orderNumber).includes(needle) ||
          o.items.some((it) => fold(it.productNameAr ?? '').includes(needle) || fold(it.productNameEn ?? '').includes(needle))),
    );
  }, [all, group, q]);

  const tabs = [{ id: null as string | null, t: 'الكل', n: all.length }].concat(
    ORDER_GROUPS.filter((g) => counts[g.id] > 0).map((g) => ({ id: g.id, t: g.t, n: counts[g.id] })),
  );

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('طلباتي')}</h1>
        <Link href="/codes" className="btn-quiet min-h-10 text-teal">
          {t('أكوادي')}
        </Link>
      </div>

      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{res.error}</div>
      )}

      {!res.loading && all.length === 0 && !res.error && (
        <div className="surface mt-6 rounded-2xl p-8 text-center shadow-card sm:p-12">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal/10 text-teal">
            <BagIcon size={26} />
          </div>
          <p className="mt-4 font-extrabold">{t('لا توجد طلبات بعد.')}</p>
          <Link href="/products" className="btn-brand mt-5 inline-flex min-h-11 items-center rounded-xl px-6 text-sm font-bold">
            {t('ابدأ التسوّق')}
          </Link>
        </div>
      )}

      {all.length > 0 && (
        <div className="mt-5 space-y-3">
          <label className="surface flex min-h-12 items-center gap-2 rounded-2xl px-4 focus-within:border-teal">
            <SearchIcon size={18} className="flex-none text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('ابحث برقم الطلب أو اسم المنتج')}
              aria-label={t('ابحث في طلباتي')}
              className="w-full min-w-0 bg-transparent text-[15px] outline-none"
            />
          </label>
          {tabs.length > 2 && (
            <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
              <div role="tablist" aria-label={t('حالة الطلب')} className="flex w-max gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id ?? 'all'}
                    role="tab"
                    aria-selected={group === tab.id}
                    onClick={() => setGroup(tab.id)}
                    className="chip"
                  >
                    {t(tab.t)} <span className="tnum opacity-70">{tab.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {all.length > 0 && shown.length === 0 && (
        <p className="mt-8 text-center text-sm text-muted">{t('لا توجد طلبات تطابق بحثك.')}</p>
      )}

      <div className="mt-4 space-y-3">
        {res.loading && !res.data && [0, 1, 2].map((i) => <OrderSkeleton key={i} />)}
        {shown.map((o) => {
          const c = chip(o.status);
          const first = o.items[0];
          const img = first ? art(first) : undefined;
          const more = o.items.length - 1;
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="surface flex items-center gap-3 rounded-2xl p-3.5 shadow-card transition hover:shadow-float active:scale-[0.99]"
            >
              <span className="grid h-14 w-14 flex-none place-items-center overflow-hidden rounded-xl bg-[rgb(var(--surface-2))] text-muted">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local vector art
                  <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <BagIcon size={24} />
                )}
              </span>
              <div className="min-w-0 flex-1">
                {/* what was bought first (the name in full, up to two lines), then where it stands */}
                <p className="line-clamp-2 font-bold leading-snug">
                  {first ? `${name(first)}${first.quantity > 1 ? ` ×${first.quantity}` : ''}` : o.orderNumber}
                  {more > 0 && <span className="font-semibold text-muted"> {t('+{n} أخرى', { n: more })}</span>}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className={`rounded-full px-2.5 py-0.5 font-bold ${c.c}`}>{t(c.t)}</span>
                  <span dir="ltr">{o.orderNumber}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted">
                  <span>{day(o.createdAt)}</span>
                  <span className="tnum text-sm font-extrabold text-[rgb(var(--text))]">{money(o.total, o.currency)}</span>
                </div>
              </div>
              <ChevronIcon className="flex-none text-muted ltr:rotate-180" />
            </Link>
          );
        })}
      </div>

      {res.data?.truncated && (
        <p className="mt-4 text-center text-xs text-muted">{t('تظهر آخر {n} طلبًا.', { n: all.length })}</p>
      )}
    </div>
  );
}
