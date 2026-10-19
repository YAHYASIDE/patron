'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { moneyIn, date, dateTime, statusChip, GATEWAY_LABEL } from '@/lib/format';
import { MAIN_COUNTRIES, countryName, flagOf } from '@/lib/countries';
import ExportButton from '@/components/ExportButton';

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  total: number | string;
  currency: string;
  createdAt: string;
  user?: { email?: string | null; fullName?: string; phone?: string | null; country?: string | null };
  payments?: { id: string; gateway: string; status: string }[];
  adminNote?: string | null;
  country?: string | null;
};
type OrdersResp = { data: OrderRow[]; meta?: { hasMore: boolean; nextCursor: string | null } };

type PendingTransfer = {
  id: string;
  amount: string;
  currency: string;
  updatedAt: string;
  rawResponse: { transfer?: { method: string; reference?: string; payerPhone?: string } } | null;
  order: { id: string; orderNumber: string; user: { fullName: string; email: string } };
};

const FILTERS: { key: string; label: string }[] = [
  { key: '', label: 'الكل' },
  { key: 'PAID', label: 'مدفوع · بانتظار التسليم' },
  { key: 'PENDING_PAYMENT', label: 'بانتظار الدفع' },
  { key: 'PROCESSING', label: 'قيد التنفيذ' },
  { key: 'COMPLETED', label: 'مكتمل' },
];

const GATEWAYS = ['MANUAL', 'WALLET', 'STRIPE'];

/** yyyy-mm-dd (local day) → ISO instant; `end` gives the start of the next day so the day is included. */
function dayIso(day: string, end = false): string {
  const d = new Date(`${day}T00:00:00`);
  if (end) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

const select =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal';

export default function OrdersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState(true);
  const [gateway, setGateway] = useState('');
  const [country, setCountry] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const filtered = !!(gateway || country || from || to);
  const pending = useFetch<PendingTransfer[]>('/admin/payments/manual/pending');

  const load = useCallback(
    async (next: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ limit: '20' });
        if (next) qs.set('cursor', next);
        if (status) qs.set('status', status);
        if (search) qs.set('search', search);
        if (gateway) qs.set('gateway', gateway);
        if (country) qs.set('country', country);
        if (from) qs.set('from', dayIso(from));
        if (to) qs.set('to', dayIso(to, true));
        const resp = await api.get<OrdersResp>(`/admin/orders?${qs.toString()}`);
        setRows((prev) => (next ? [...prev, ...resp.data] : resp.data));
        setHasMore(resp.meta?.hasMore ?? false);
        setCursor(resp.meta?.nextCursor ?? null);
      } catch (e) {
        // an older server rejects the new filter fields
        setError(
          e instanceof ApiError && /should not exist/i.test(e.message)
            ? 'فلاتر الدفع والدولة والتاريخ غير متاحة بعد على الخادم.'
            : e instanceof ApiError
              ? e.message
              : 'تعذّر جلب الطلبات',
        );
        if (!next) setRows([]);
      } finally {
        setLoading(false);
        setFirst(false);
      }
    },
    [status, search, gateway, country, from, to],
  );

  // the customers page links here with ?search=<their number>
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('search');
    if (s) {
      setQ(s);
      setSearch(s);
    }
  }, []);

  // search as the owner types, without a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim().replace(/^[\d\s+]+$/, (n) => n.replace(/\s/g, ''))), 350);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    load(null);
  }, [load]);

  const transfers = pending.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">الطلبات</h1>
          <p className="mt-1 text-sm text-muted">
            كل طلبات المتجر، الأحدث أولاً. اضغط على طلب لتأكيد دفعه وتسليمه.
          </p>
        </div>
        <ExportButton
          path={`/admin/export/orders.csv${
            from || to
              ? '?' +
                new URLSearchParams({
                  ...(from && { from: dayIso(from) }),
                  ...(to && { to: dayIso(to, true) }),
                }).toString()
              : ''
          }`}
          filename={`orders-${new Date().toLocaleDateString('en-CA')}.csv`}
          label={from || to ? 'تصدير الفترة CSV' : 'تصدير CSV'}
        />
      </div>

      {transfers.length > 0 && (
        <section className="surface rounded-2xl border border-warn/40 p-5 shadow-card">
          <h2 className="text-base font-bold">
            تحويلات بانتظار تأكيدك <span className="tnum text-warn">({transfers.length})</span>
          </h2>
          <p className="mt-1 text-xs text-muted">
            تحقّق من وصول المبلغ إلى حسابك، ثم افتح الطلب وأكّد الدفع.
          </p>
          <div className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
            {transfers.map((t) => (
              <Link
                key={t.id}
                href={`/orders/${t.order.id}`}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm hover:opacity-80"
              >
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {t.order.user.fullName} · <span dir="ltr">{t.order.orderNumber}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {t.rawResponse?.transfer?.method} · من{' '}
                    <span className="font-mono" dir="ltr">
                      {t.rawResponse?.transfer?.payerPhone ?? t.rawResponse?.transfer?.reference}
                    </span>{' '}
                    · {dateTime(t.updatedAt)}
                  </span>
                </div>
                <span className="tnum font-bold">{moneyIn(t.amount, t.currency)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث برقم الطلب أو اسم الزبون أو رقم واتساب"
        className="surface hairline rounded-xl border px-4 py-3 text-[15px] outline-none focus:border-teal"
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setStatus(f.key)}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (status === f.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">طريقة الدفع</span>
          <select value={gateway} onChange={(e) => setGateway(e.target.value)} className={select}>
            <option value="">الكل</option>
            {GATEWAYS.map((g) => (
              <option key={g} value={g}>
                {GATEWAY_LABEL[g] ?? g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">دولة الزبون</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={select}>
            <option value="">الكل</option>
            {MAIN_COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {flagOf(c)} {countryName(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">من يوم</span>
          <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={select} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-xs font-semibold text-muted">إلى يوم</span>
          <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={select} />
        </label>
      </div>
      {filtered && (
        <button
          onClick={() => {
            setGateway('');
            setCountry('');
            setFrom('');
            setTo('');
          }}
          className="self-start text-xs font-bold text-teal hover:underline"
        >
          مسح الفلاتر
        </button>
      )}

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
      )}

      <div className="surface overflow-hidden rounded-2xl shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                {['رقم الطلب', 'العميل', 'الحالة', 'الإجمالي', 'التاريخ'].map((h) => (
                  // phones: the customer shows under the order number instead
                  <th
                    key={h}
                    className={
                      'px-5 py-3 text-start text-xs font-semibold ' +
                      (h === 'العميل' || h === 'التاريخ' || h === 'الحالة' ? 'hidden sm:table-cell' : '')
                    }
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {first && loading && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted">
                    لا توجد طلبات هنا.
                  </td>
                </tr>
              )}
              {rows.map((o) => {
                const chip = statusChip(o.status);
                const awaitingReview = o.payments?.some(
                  (p) => p.gateway === 'MANUAL' && p.status === 'AUTHORIZED',
                );
                return (
                  <tr
                    key={o.id}
                    onClick={() => router.push(`/orders/${o.id}`)}
                    className="cursor-pointer border-t hairline transition hover:bg-[rgb(var(--line))]/30"
                  >
                    <td className="px-5 py-3 font-semibold">
                      <Link
                        href={`/orders/${o.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="whitespace-nowrap hover:underline"
                        dir="ltr"
                      >
                        {o.orderNumber}
                      </Link>
                      <div className="mt-0.5 text-xs font-normal text-muted sm:hidden">
                        {o.user?.fullName ?? o.user?.email ?? '—'} · {date(o.createdAt)}
                      </div>
                      {/* phones: the status shows here instead of its own column */}
                      <div className="mt-1.5 flex flex-wrap gap-1.5 sm:hidden">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>
                          {chip.label}
                        </span>
                        {awaitingReview && (
                          <span className="whitespace-nowrap rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-bold text-warn">
                            تحويل للتأكيد
                          </span>
                        )}
                      </div>
                      {o.adminNote && (
                        <div className="mt-1 max-w-56 truncate text-xs font-normal text-gold-deep" title={o.adminNote}>
                          ملاحظة: {o.adminNote}
                        </div>
                      )}
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <div className="font-semibold">
                        {(o.country ?? o.user?.country) && (
                          <span title={countryName(o.country ?? o.user?.country)}>{flagOf(o.country ?? o.user?.country)} </span>
                        )}
                        {o.user?.fullName ?? '—'}
                      </div>
                      <div className="text-xs text-muted" dir="ltr">
                        {o.user?.phone ?? o.user?.email}
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <div className="flex flex-col items-start gap-1.5">
                        <span
                          className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}
                        >
                          {chip.label}
                        </span>
                        {awaitingReview && (
                          <span className="whitespace-nowrap rounded-full bg-warn/12 px-2.5 py-1 text-xs font-bold text-warn">
                            تحويل للتأكيد
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 tnum font-semibold">
                      {moneyIn(o.total, o.currency)}
                    </td>
                    <td className="hidden px-5 py-3 text-muted sm:table-cell">{date(o.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-center">
        {hasMore ? (
          <button
            disabled={loading}
            onClick={() => load(cursor)}
            className="rounded-xl border border-[rgb(var(--line))] px-5 py-2 text-sm font-semibold disabled:opacity-40"
          >
            {loading ? 'جارٍ…' : 'تحميل المزيد'}
          </button>
        ) : (
          rows.length > 0 && <span className="text-xs text-muted">هذه كل الطلبات.</span>
        )}
      </div>
    </div>
  );
}
