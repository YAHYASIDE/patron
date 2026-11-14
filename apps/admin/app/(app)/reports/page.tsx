'use client';

import { useMemo, useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { reportSummaryPath, type ReportSummary } from '@/lib/api';
import { money, num } from '@/lib/format';
import ExportButton from '@/components/ExportButton';
import SalesChart from '@/components/charts/SalesChart';
import { Card, Countries, Customers, Empty, Kpi, Losses, Methods, Products, TodayHero, n } from './sections';

const RANGES = [
  { id: 'today', label: 'اليوم' },
  { id: '7d', label: 'آخر 7 أيام' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'last-month', label: 'الشهر الماضي' },
  { id: 'custom', label: 'فترة أخرى' },
] as const;
type RangeId = (typeof RANGES)[number]['id'];
type Span = { from: string; to: string };

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;
// UTC days, like the API: the shop's day is Nouakchott's, which is UTC
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);

function rangeOf(id: Exclude<RangeId, 'custom'>): Span {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = Date.UTC(y, m, now.getUTCDate());
  if (id === 'today') return { from: ymd(today), to: ymd(today) };
  if (id === '7d') return { from: ymd(today - 6 * DAY_MS), to: ymd(today) };
  if (id === 'month') return { from: ymd(Date.UTC(y, m, 1)), to: ymd(today) };
  return { from: ymd(Date.UTC(y, m - 1, 1)), to: ymd(Date.UTC(y, m, 0)) };
}

const longDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The owner's reports: today's profit, profit and losses for a period, how customers paid, best customers and products. */
export default function ReportsPage() {
  const [range, setRange] = useState<RangeId>('month');
  const [custom, setCustom] = useState<Span>(() => rangeOf('7d'));
  const [draft, setDraft] = useState<Span>(() => rangeOf('7d'));
  const [draftError, setDraftError] = useState<string | null>(null);

  const span = useMemo(() => (range === 'custom' ? custom : rangeOf(range)), [range, custom]);
  const { data, error, loading, reload } = useFetch<ReportSummary>(reportSummaryPath(span.from, span.to));

  function applyCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.from || !draft.to) return setDraftError('اختر تاريخ البداية وتاريخ النهاية.');
    if (draft.from > draft.to) return setDraftError('تاريخ البداية يجب أن يكون قبل تاريخ النهاية.');
    const days = (Date.parse(draft.to) - Date.parse(draft.from)) / DAY_MS + 1;
    if (days > MAX_DAYS) return setDraftError(`الفترة طويلة جدًّا: ${MAX_DAYS} يومًا على الأكثر.`);
    setDraftError(null);
    setCustom(draft);
  }

  const t = data?.totals;
  const points = useMemo(
    () =>
      (data?.series ?? []).map((d) => ({
        date: d.date,
        revenue: n(d.revenue),
        profit: n(d.profit),
        orders: d.orders,
      })),
    [data],
  );
  const salesDays = (data?.series ?? []).filter((d) => d.orders > 0).reverse();
  const periodLabel =
    span.from === span.to ? longDay(span.from) : `${longDay(span.from)} – ${longDay(span.to)}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">التقارير</h1>
          <p className="mt-1 text-sm leading-6 text-muted">
            الأرباح والخسائر وطرق الدفع وأفضل الزبائن، بالدولار.
          </p>
        </div>
        <ExportButton
          path={`/admin/export/orders.csv?from=${span.from}&to=${span.to}`}
          filename={`orders-${span.from}-${span.to}.csv`}
          label="تصدير طلبات الفترة CSV"
        />
      </div>

      {data && <TodayHero today={data.today} />}

      {/* one filter row; it scopes everything below it */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="الفترة">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
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
        {range === 'custom' && (
          <form
            noValidate
            onSubmit={applyCustom}
            className="surface flex flex-wrap items-end gap-3 rounded-2xl p-3.5 shadow-card"
          >
            <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">من</span>
              <input
                type="date"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className="surface-2 hairline w-full rounded-xl border px-3 py-2 text-[15px] outline-none focus:border-teal"
              />
            </label>
            <label className="flex min-w-[8.5rem] flex-1 flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted">إلى</span>
              <input
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className="surface-2 hairline w-full rounded-xl border px-3 py-2 text-[15px] outline-none focus:border-teal"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-deep"
            >
              عرض
            </button>
            {draftError && <p className="w-full text-sm font-semibold text-bad">{draftError}</p>}
          </form>
        )}
        <p className="text-xs text-muted">{periodLabel}</p>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          <span>{error}</span>
          <button type="button" onClick={reload} className="font-bold underline underline-offset-4">
            إعادة المحاولة
          </button>
        </div>
      )}

      {!data && loading && (
        <div className="surface rounded-2xl p-5 text-sm text-muted shadow-card">جارٍ تحميل التقارير…</div>
      )}

      {data && t && (
        // a refetch keeps the previous figures on screen, dimmed, instead of a blank page
        <div
          className={`flex flex-col gap-5 transition-opacity ${loading ? 'opacity-60' : ''}`}
          aria-busy={loading}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Kpi
              label="المبيعات"
              value={money(t.revenue)}
              hint={`صافي بعد الاسترجاع · ${t.orders} طلب مدفوع`}
            />
            <Kpi label="التكلفة" value={money(t.cost)} hint="ما دفعته في المنتجات" />
            <Kpi
              label="الربح"
              value={money(t.profit)}
              tone={n(t.profit) < 0 ? 'bad' : n(t.profit) > 0 ? 'ok' : undefined}
              hint="المبيعات ناقص التكلفة"
            />
            <Kpi
              label="خسائر تحت التكلفة"
              value={money(data.losses.total)}
              tone={n(data.losses.total) > 0 ? 'bad' : undefined}
              hint="ما بعته بأقل مما كلّفك"
            />
            <Kpi
              label="الهامش"
              value={`${num(t.marginPercent, 1)}%`}
              hint={`تربح ${num(t.marginPercent, 1)} من كل 100 تبيع بها`}
            />
            <Kpi
              label="متوسط الطلب"
              value={money(t.averageOrder)}
              hint={`${t.itemsDelivered} منتج مُسلَّم`}
            />
          </div>

          <Card
            title="المبيعات والربح يومًا بيوم"
            hint="المبيعات صافي بعد الاسترجاع. مرّر إصبعك على الرسم لترى أرقام كل يوم."
          >
            {points.length < 2 ? (
              <Empty>الرسم يظهر عند اختيار أكثر من يوم. أرقام اليوم في البطاقات أعلاه.</Empty>
            ) : t.orders === 0 ? (
              <Empty>لا مبيعات في هذه الفترة.</Empty>
            ) : (
              <SalesChart points={points} />
            )}
            {salesDays.length > 0 && (
              <details className="group mt-4">
                <summary className="cursor-pointer select-none text-sm font-bold text-teal">
                  الأرقام يومًا بيوم ({salesDays.length} يوم فيه مبيعات)
                </summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[17rem] text-sm">
                    <thead>
                      <tr className="text-xs text-muted">
                        <th className="py-2 text-start font-semibold">اليوم</th>
                        <th className="py-2 text-end font-semibold">الطلبات</th>
                        <th className="py-2 text-end font-semibold">المبيعات</th>
                        <th className="py-2 text-end font-semibold">الربح</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[rgb(var(--line))]">
                      {salesDays.map((d) => (
                        <tr key={d.date}>
                          <td className="py-2 font-semibold">{longDay(d.date)}</td>
                          <td className="tnum py-2 text-end">{d.orders}</td>
                          <td className="tnum py-2 text-end">{money(d.revenue)}</td>
                          <td
                            className={`tnum py-2 text-end font-bold ${n(d.profit) >= 0 ? 'text-ok' : 'text-bad'}`}
                          >
                            {money(d.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="طرق الدفع" hint="بأي تطبيق دفع لك الزبائن في هذه الفترة.">
              <Methods rows={data.byMethod} />
            </Card>
            <Card
              title="خسائر البيع تحت التكلفة"
              hint="ما بعته بأقل مما كلّفك، وما زلت مدينًا به للزبائن، وما أعدته لهم."
              aside={
                <span
                  className={`tnum text-lg font-extrabold ${n(data.losses.total) > 0 ? 'text-bad' : 'text-muted'}`}
                >
                  {money(data.losses.total)}
                </span>
              }
            >
              <Losses losses={data.losses} />
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="أفضل الزبائن" hint="الأكثر شراءً في هذه الفترة.">
              <Customers rows={data.topCustomers} />
            </Card>
            <Card title="الأكثر مبيعًا" hint="المنتجات حسب عدد القطع المُباعة.">
              <Products rows={data.topProducts} />
            </Card>
          </div>

          <Card title="حسب الدولة" hint="من أين يشتري زبائنك.">
            <Countries rows={data.byCountry} total={n(t.revenue)} />
          </Card>
        </div>
      )}
    </div>
  );
}
