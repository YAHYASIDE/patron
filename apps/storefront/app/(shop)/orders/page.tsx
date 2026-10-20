'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { ChevronIcon, SearchIcon } from '@/components/icons';
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

export default function OrdersPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/orders');
  }, [router]);

  const res = useFetch(loadAll, []);
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('طلباتي')}</h1>
        <Link href="/codes" className="text-sm font-bold text-teal hover:underline">
          {t('أكوادي')}
        </Link>
      </div>

      {res.loading && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{res.error}</div>
      )}

      {!res.loading && all.length === 0 && !res.error && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          {t('لا توجد طلبات بعد.')}{' '}
          <Link href="/products" className="font-bold text-teal hover:underline">
            {t('ابدأ التسوّق')}
          </Link>
        </div>
      )}

      {all.length > 0 && (
        <div className="mt-5 space-y-3">
          <label className="surface flex items-center gap-2 rounded-xl px-3.5 py-2.5">
            <SearchIcon size={17} className="flex-none text-muted" />
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
            <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div role="tablist" aria-label={t('حالة الطلب')} className="flex w-max gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id ?? 'all'}
                    role="tab"
                    aria-selected={group === tab.id}
                    onClick={() => setGroup(tab.id)}
                    className={
                      'whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold transition ' +
                      (group === tab.id ? 'bg-teal text-white' : 'surface text-muted hover:text-[rgb(var(--text))]')
                    }
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
        {shown.map((o) => {
          const c = chip(o.status);
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="surface flex items-center justify-between gap-3 rounded-2xl p-4 shadow-card transition hover:shadow-float"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-bold" dir="ltr">
                    {o.orderNumber}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c.c}`}>{t(c.t)}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-muted">
                  {o.items.map((it) => `${name(it)} ×${it.quantity}`).join(lang === 'ar' ? '، ' : ', ')}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                  <span>{day(o.createdAt)}</span>
                  <span aria-hidden>·</span>
                  <span className="tnum font-bold text-[rgb(var(--text))]">{money(o.total, o.currency)}</span>
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
