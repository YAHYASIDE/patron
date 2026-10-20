'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { dateTime, moneyIn, num } from '@/lib/format';
import Notice from '@/components/Notice';
import UsdtSettings from './UsdtSettings';
import { STATUS, type UsdtOrderRow, type UsdtStatus } from './shared';

type ListResp = { data: UsdtOrderRow[]; total: number; page: number; limit: number; counts: Partial<Record<UsdtStatus, number>> };

// the work queue first: what needs the owner now
const TABS: { key: UsdtStatus | ''; label: string }[] = [
  { key: 'UNDER_REVIEW', label: 'للمراجعة' },
  { key: 'READY_TO_SEND', label: 'جاهز للإرسال' },
  { key: 'AWAITING_PAYMENT', label: 'بانتظار الدفع' },
  { key: 'COMPLETED', label: 'مكتمل' },
  { key: 'REJECTED', label: 'مرفوض' },
  { key: 'CANCELLED', label: 'ملغي' },
  { key: '', label: 'الكل' },
];

/** USDT orders by status, and the owner's terms for selling USDT. */
export default function UsdtPage() {
  const [view, setView] = useState<'orders' | 'settings'>('orders');
  const [status, setStatus] = useState<UsdtStatus | ''>('UNDER_REVIEW');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => setPage(1), [status, search]);

  const qs = new URLSearchParams({ page: String(page), limit: '30' });
  if (status) qs.set('status', status);
  if (search) qs.set('search', search);
  const list = useFetch<ListResp>(view === 'orders' ? `/admin/usdt/orders?${qs.toString()}` : null);
  const counts = list.data?.counts ?? {};
  const rows = list.data?.data ?? [];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.limit)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">طلبات USDT</h1>
          <p className="mt-1 text-sm text-muted">
            تحقّق من التحويل، أرسل USDT يدويًا من محفظتك، ثم سجّل رقم العملية. لا يُرسل شيء تلقائيًا.
          </p>
        </div>
        <div className="surface-2 flex rounded-xl p-1 text-sm font-bold">
          {(['orders', 'settings'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`min-h-10 rounded-lg px-4 ${view === v ? 'bg-teal text-white' : 'text-muted'}`}
            >
              {v === 'orders' ? 'الطلبات' : 'الإعدادات'}
            </button>
          ))}
        </div>
      </div>

      {view === 'settings' ? (
        <UsdtSettings />
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث برقم الطلب أو العنوان أو TXID أو رقم الزبون"
            className="surface hairline rounded-xl border px-4 py-3 text-[15px] outline-none focus:border-teal"
          />

          <div className="flex gap-2 overflow-x-auto pb-1">
            {TABS.map((tab) => (
              <button
                key={tab.key || 'all'}
                onClick={() => setStatus(tab.key)}
                className={
                  'inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
                  (status === tab.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
                }
              >
                {tab.label}
                {tab.key && counts[tab.key] ? <span className="tnum">({counts[tab.key]})</span> : null}
              </button>
            ))}
          </div>

          {list.error && <Notice text={list.error} />}

          <div className="flex flex-col gap-2">
            {list.loading && !list.data && (
              <div className="surface rounded-2xl px-5 py-8 text-center text-sm text-muted shadow-card">جارٍ التحميل…</div>
            )}
            {!list.loading && rows.length === 0 && !list.error && (
              <div className="surface rounded-2xl px-5 py-8 text-center text-sm text-muted shadow-card">لا توجد طلبات هنا.</div>
            )}
            {rows.map((o) => (
              <Link
                key={o.id}
                href={`/usdt/${o.id}`}
                className="surface flex flex-col gap-2 rounded-2xl p-4 text-sm shadow-card transition hover:opacity-80 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tnum text-base font-extrabold">{num(o.amountUsdt, 2)} USDT</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                  </div>
                  <span className="truncate text-xs text-muted">
                    {o.user?.fullName} ·{' '}
                    <span dir="ltr">{o.user?.phone ?? ''}</span> · <span dir="ltr">{o.number}</span>
                  </span>
                  <span dir="ltr" className="truncate text-start font-mono text-xs text-muted">
                    {o.delivery === 'BINANCE' ? `Binance ${o.binanceId}` : `${o.network} ${o.address}`}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 sm:flex-col sm:items-end">
                  <span className="tnum font-bold">{moneyIn(o.total, o.currency)}</span>
                  <span className="text-xs text-muted">{dateTime(o.createdAt)}</span>
                </div>
              </Link>
            ))}
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="surface-2 min-h-10 rounded-xl px-4 font-bold disabled:opacity-40">
                السابق
              </button>
              <span className="tnum text-muted">
                {page} / {pages}
              </span>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="surface-2 min-h-10 rounded-xl px-4 font-bold disabled:opacity-40">
                التالي
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
