'use client';

import { useMemo, useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import ExportButton from '@/components/ExportButton';

type ProfitRow = {
  period: string;
  revenue: string;
  cost: string;
  profit: string;
  margin_percent: string;
  items: number;
};
type ProductRow = {
  sku: string;
  name: string;
  name_ar: string;
  units: number;
  revenue_base: string;
  profit_base: string;
  margin_percent: string;
};

const RANGES = [
  { id: 'today', label: 'اليوم' },
  { id: '7d', label: 'آخر 7 أيام' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'last-month', label: 'الشهر الماضي' },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

function rangeOf(id: RangeId): { from: string; to: string } {
  const now = new Date();
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (id === 'today') return { from: start(now).toISOString(), to: now.toISOString() };
  if (id === '7d')
    return { from: new Date(start(now).getTime() - 6 * 86_400_000).toISOString(), to: now.toISOString() };
  if (id === 'month')
    return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString() };
  return {
    from: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString(),
    to: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
  };
}

const n = (v: string | number) => parseFloat(String(v)) || 0;

/** Sales and profit for a period, by day and by product (base currency, delivered items). */
export default function ReportsPage() {
  const [range, setRange] = useState<RangeId>('7d');
  const { from, to } = useMemo(() => rangeOf(range), [range]);
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const profit = useFetch<{ series: ProfitRow[] }>(`/admin/reports/profit?granularity=day&${qs}`);
  const products = useFetch<ProductRow[]>(`/admin/reports/products?limit=15&${qs}`);

  const totals = (profit.data?.series ?? []).reduce(
    (t, r) => ({
      revenue: t.revenue + n(r.revenue),
      cost: t.cost + n(r.cost),
      profit: t.profit + n(r.profit),
      items: t.items + n(r.items),
    }),
    { revenue: 0, cost: 0, profit: 0, items: 0 },
  );
  const margin = totals.revenue > 0 ? (100 * totals.profit) / totals.revenue : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">التقارير</h1>
          <p className="mt-1 text-sm text-muted">
            المبيعات والأرباح من المنتجات المُسلَّمة، بالدولار (العملة الأساسية).
          </p>
        </div>
        <ExportButton
          path={`/admin/export/orders.csv?${qs}`}
          filename={`orders-${range}-${new Date().toLocaleDateString('en-CA')}.csv`}
          label="تصدير طلبات الفترة CSV"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={
              'rounded-full px-4 py-2 text-sm font-bold transition ' +
              (range === r.id ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {(profit.error || products.error) && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {profit.error ?? products.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="المبيعات" value={money(totals.revenue)} />
        <Kpi label="التكلفة" value={money(totals.cost)} />
        <Kpi label="الربح" value={money(totals.profit)} tone={totals.profit >= 0 ? 'ok' : 'bad'} />
        <Kpi label="الهامش" value={`${margin.toFixed(1)}%`} hint={`${totals.items} منتج مُسلَّم`} />
      </div>

      <section className="surface rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">حسب اليوم</h2>
        {profit.loading && <p className="mt-3 text-sm text-muted">جارٍ التحميل…</p>}
        {!profit.loading && (profit.data?.series.length ?? 0) === 0 && (
          <p className="mt-3 text-sm text-muted">لا مبيعات في هذه الفترة.</p>
        )}
        <div className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
          {[...(profit.data?.series ?? [])].reverse().map((r) => (
            <div key={r.period} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="font-semibold">{date(r.period)}</span>
              <span className="text-muted">{r.items} منتج</span>
              <span className="tnum">{money(r.revenue)}</span>
              <span className={`tnum font-bold ${n(r.profit) >= 0 ? 'text-ok' : 'text-bad'}`}>
                {money(r.profit)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="surface rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">الأكثر ربحًا</h2>
        {products.loading && <p className="mt-3 text-sm text-muted">جارٍ التحميل…</p>}
        {!products.loading && (products.data?.length ?? 0) === 0 && (
          <p className="mt-3 text-sm text-muted">لا مبيعات بعد.</p>
        )}
        <div className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
          {products.data?.map((p) => (
            <div key={p.sku} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate font-semibold">{p.name_ar || p.name}</div>
                <div className="text-xs text-muted">
                  {p.units} مُباع · هامش {n(p.margin_percent).toFixed(1)}%
                </div>
              </div>
              <div className="text-end">
                <div className="tnum font-bold text-ok">{money(p.profit_base)}</div>
                <div className="tnum text-xs text-muted">{money(p.revenue_base)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'bad';
}) {
  return (
    <div className="surface rounded-2xl p-4 shadow-card">
      <div className="text-xs font-semibold text-muted">{label}</div>
      <div
        className={`tnum mt-1 text-xl font-extrabold ${tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : ''}`}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
