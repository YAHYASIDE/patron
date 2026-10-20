'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { reportSummaryPath, type ReportSummary } from '@/lib/api';
import { num, money, moneyIn, date, statusChip } from '@/lib/format';
import Notice from '@/components/Notice';
import LearnCard from '@/components/LearnCard';
import AttentionPanel from '@/components/AttentionPanel';
import SalesChart from '@/components/charts/SalesChart';

type Day = { revenue: string | number; cost: string | number; profit: string | number; orders: number };
type Overview = {
  today: Day;
  yesterday: Day;
  pendingTransfers: number;
  pendingVerifications: number;
  openTickets: number;
  lowStock: { productId: string; sku: string; nameAr: string; available: number }[];
  marginAlerts: {
    productId: string;
    sku: string;
    nameAr: string;
    sellPrice: string | number;
    costPrice: string | number;
    marginPercent: string | number;
  }[];
  staleFx: string[];
};
type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  total: number | string;
  currency: string;
  createdAt: string;
};
type Paginated<T> = { data: T[] };

// thresholds the overview is asked for: stock at or under 3 codes, margin under 5%
const LOW_STOCK = 3;
const TARGET_MARGIN = 5;

const n = (v: string | number | null | undefined) => parseFloat(String(v ?? 0)) || 0;

const DAY_MS = 86_400_000;
// UTC days, like the API: the shop's day is Nouakchott's, which is UTC
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('ar-EG-u-nu-latn', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/** The last 14 days, today included (a bare `to` date counts its whole day). */
function last14Days(): { from: string; to: string } {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { from: ymd(today - 13 * DAY_MS), to: ymd(today) };
}

/** Today against yesterday: "+12%" in green, "−8%" in red, or a plain word when yesterday was zero. */
function Delta({ today, yesterday }: { today: number; yesterday: number }) {
  if (yesterday === 0) {
    return <span className="text-xs text-muted">{today > 0 ? 'لا شيء أمس' : 'مثل أمس'}</span>;
  }
  const pct = ((today - yesterday) / Math.abs(yesterday)) * 100;
  const up = pct >= 0;
  return (
    <span className={`tnum text-xs font-bold ${up ? 'text-ok' : 'text-bad'}`} dir="ltr">
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function CompareCard({
  label,
  today,
  yesterday,
  fmt,
  loading,
}: {
  label: string;
  today: number;
  yesterday: number;
  fmt: (v: number) => string;
  loading: boolean;
}) {
  return (
    <div className="surface rounded-2xl p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-muted">{label}</span>
        {!loading && <Delta today={today} yesterday={yesterday} />}
      </div>
      {loading ? (
        <div aria-hidden className="surface-2 mt-2.5 h-7 w-24 max-w-full animate-pulse rounded-lg" />
      ) : (
        <div className="mt-2 text-2xl font-extrabold tnum">{fmt(today)}</div>
      )}
      <div className="mt-1 text-[11.5px] text-muted">
        أمس: <span className="tnum font-semibold">{loading ? '…' : fmt(yesterday)}</span>
      </div>
    </div>
  );
}

/** One figure for the last 14 days; amounts read left to right. */
function KpiCard({
  label,
  value,
  sub,
  tone,
  loading,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  tone?: 'ok' | 'bad';
  loading: boolean;
}) {
  return (
    <div className="surface min-w-0 rounded-2xl p-4 shadow-card">
      <div className="text-[13px] font-semibold text-muted">{label}</div>
      {loading ? (
        <>
          <div aria-hidden className="surface-2 mt-2.5 h-7 w-24 max-w-full animate-pulse rounded-lg" />
          <div aria-hidden className="surface-2 mt-2 h-3 w-16 max-w-full animate-pulse rounded" />
        </>
      ) : (
        <>
          <div
            className={`mt-2 text-xl font-extrabold leading-tight tnum [overflow-wrap:anywhere] sm:text-2xl ${
              tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : ''
            }`}
          >
            <span dir="ltr">{value}</span>
          </div>
          <div className="mt-1 text-[11.5px] text-muted">{sub}</div>
        </>
      )}
    </div>
  );
}

function TodoCard({
  label,
  hint,
  count,
  href,
}: {
  label: string;
  hint: string;
  count: number;
  href: string;
}) {
  const waiting = count > 0;
  return (
    <Link
      href={href}
      className={
        'surface flex items-center gap-3 rounded-2xl p-4 shadow-card transition hover:border-teal ' +
        (waiting ? 'border-warn/50' : '')
      }
    >
      <span
        className={
          'grid h-11 min-w-11 flex-none place-items-center rounded-xl px-2 text-lg font-extrabold tnum ' +
          (waiting ? 'bg-warn/12 text-warn' : 'surface-2 text-muted')
        }
      >
        {num(count)}
      </span>
      <span className="min-w-0">
        <span className="block font-bold">{label}</span>
        <span className="block text-xs text-muted">{waiting ? hint : 'لا شيء الآن'}</span>
      </span>
      <span aria-hidden className="ms-auto text-muted">
        ←
      </span>
    </Link>
  );
}

/** Lists on the dashboard show this many rows before "عرض الكل". */
const CAP = 5;

function ShowAll({ total, open, onToggle }: { total: number; open: boolean; onToggle: () => void }) {
  if (total <= CAP) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="mt-2 min-h-10 w-full rounded-xl surface-2 text-sm font-bold text-teal transition hover:opacity-80"
    >
      {open ? 'عرض أقل' : `عرض الكل (${num(total)})`}
    </button>
  );
}

export default function DashboardPage() {
  const [allStock, setAllStock] = useState(false);
  const [allMargin, setAllMargin] = useState(false);
  const ov = useFetch<Overview>(`/admin/insights/overview?lowStock=${LOW_STOCK}&margin=${TARGET_MARGIN}`);
  const orders = useFetch<Paginated<OrderRow>>('/admin/orders?limit=6');
  const span = last14Days();
  const trend = useFetch<ReportSummary>(reportSummaryPath(span.from, span.to));

  const d = ov.data;
  const loading = ov.loading && !d;
  const t = d?.today;
  const y = d?.yesterday;

  const tt = trend.data?.totals;
  const trendLoading = trend.loading && !trend.data;
  const points = useMemo(
    () =>
      (trend.data?.series ?? []).map((p) => ({
        date: p.date,
        revenue: n(p.revenue),
        profit: n(p.profit),
        orders: p.orders,
      })),
    [trend.data],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">لوحة القيادة</h1>
          <p className="mt-1 text-sm text-muted">ملخّص {date(new Date().toISOString())}، مقارنةً بأمس.</p>
        </div>
        <button
          onClick={() => {
            ov.reload();
            orders.reload();
            trend.reload();
          }}
          className="min-h-10 flex-none rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-semibold text-muted transition hover:text-[rgb(var(--text))]"
        >
          تحديث
        </button>
      </div>

      {ov.error && <Notice text={ov.error} />}

      {/* stale exchange rates: prices in MRU/XOF/DZD may be off */}
      {(d?.staleFx.length ?? 0) > 0 && (
        <Link
          href="/currencies"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
        >
          <span className="font-extrabold">أسعار الصرف قديمة:</span>
          <span className="font-bold" dir="ltr">
            {d!.staleFx.join(' · ')}
          </span>
          <span className="text-xs">الأسعار بهذه العملات قد لا تطابق السوق.</span>
          <span className="ms-auto font-bold underline">حدّثها ←</span>
        </Link>
      )}

      {/* failed or late deliveries, waiting transfers, double payments, an old backup */}
      <AttentionPanel />

      {/* what needs the owner now */}
      {!ov.error && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold">مطلوب منك الآن</h2>
          <div className="grid gap-3 md:grid-cols-3">
            <TodoCard
              label="تحويلات للتأكيد"
              hint="تحقّق من وصول المبلغ ثم أكّد"
              count={d?.pendingTransfers ?? 0}
              href="/orders"
            />
            <TodoCard
              label="رموز بانتظار الإرسال"
              hint="زبائن ينتظرون رمز التحقق"
              count={d?.pendingVerifications ?? 0}
              href="/verifications"
            />
            <TodoCard
              label="طلبات دعم مفتوحة"
              hint="زبائن ينتظرون ردّك"
              count={d?.openTickets ?? 0}
              href="/support"
            />
          </div>
        </section>
      )}

      {/* today vs yesterday */}
      {!ov.error && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-bold">اليوم وأمس</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
            <CompareCard
              label="المبيعات"
              today={n(t?.revenue)}
              yesterday={n(y?.revenue)}
              fmt={(v) => money(v)}
              loading={loading}
            />
            <CompareCard
              label="الربح"
              today={n(t?.profit)}
              yesterday={n(y?.profit)}
              fmt={(v) => money(v)}
              loading={loading}
            />
            <CompareCard
              label="الطلبات"
              today={t?.orders ?? 0}
              yesterday={y?.orders ?? 0}
              fmt={(v) => num(v)}
              loading={loading}
            />
          </div>
          <p className="text-xs text-muted">بالدولار (العملة الأساسية)، من منتصف الليل.</p>
        </section>
      )}

      {/* recent orders */}
      <section className="surface overflow-hidden rounded-2xl shadow-card">
        <div className="flex items-center justify-between px-5 py-4">
          <h2 className="text-base font-bold">أحدث الطلبات</h2>
          <Link href="/orders" className="text-sm font-semibold text-teal hover:underline">
            عرض الكل
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                <th className="px-5 py-2.5 text-start text-xs font-semibold">رقم الطلب</th>
                <th className="hidden px-5 py-2.5 text-start text-xs font-semibold sm:table-cell">الحالة</th>
                <th className="px-5 py-2.5 text-start text-xs font-semibold">الإجمالي</th>
                <th className="hidden px-5 py-2.5 text-start text-xs font-semibold sm:table-cell">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {orders.loading &&
                !orders.data &&
                [0, 1, 2].map((i) => (
                  <tr key={i} aria-hidden className="border-t hairline">
                    <td colSpan={4} className="px-5 py-3">
                      <div className="surface-2 h-9 animate-pulse rounded-lg" />
                    </td>
                  </tr>
                ))}
              {!orders.loading && (orders.data?.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-muted">
                    {orders.error ? `تعذّر الجلب: ${orders.error}` : 'لا توجد طلبات بعد.'}
                  </td>
                </tr>
              )}
              {orders.data?.data?.map((o) => {
                const chip = statusChip(o.status);
                return (
                  <tr key={o.id} className="border-t hairline">
                    <td className="px-5 py-3 font-semibold">
                      <Link
                        href={`/orders/${o.id}`}
                        className="inline-flex min-h-8 items-center whitespace-nowrap hover:underline"
                        dir="ltr"
                      >
                        {o.orderNumber}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted sm:hidden">
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-bold ${chip.cls}`}>
                          {chip.label}
                        </span>
                        {date(o.createdAt)}
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 sm:table-cell">
                      <span
                        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}
                      >
                        {chip.label}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 font-semibold tnum">
                      {moneyIn(o.total, o.currency)}
                    </td>
                    <td className="hidden px-5 py-3 text-muted sm:table-cell">{date(o.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* the last 14 days, today included: net sales, profit, orders and the day-by-day trend */}
      <section className="flex flex-col gap-3" aria-busy={trend.loading}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-bold">آخر 14 يومًا</h2>
          <Link href="/reports" className="text-sm font-semibold text-teal hover:underline">
            التقارير ←
          </Link>
        </div>
        {trend.error ? (
          <Notice text={trend.error} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard
                label="صافي المبيعات"
                value={money(tt?.revenue)}
                sub="بعد الاسترجاع"
                loading={trendLoading}
              />
              <KpiCard
                label="الربح"
                value={money(tt?.profit)}
                tone={n(tt?.profit) < 0 ? 'bad' : n(tt?.profit) > 0 ? 'ok' : undefined}
                sub={
                  <>
                    هامش الربح{' '}
                    <span dir="ltr" className="tnum font-semibold">
                      {num(tt?.marginPercent, 1)}%
                    </span>
                  </>
                }
                loading={trendLoading}
              />
              <KpiCard label="عدد الطلبات" value={num(tt?.orders)} sub="طلب مدفوع" loading={trendLoading} />
              <KpiCard
                label="متوسط الطلب"
                value={money(tt?.averageOrder)}
                sub="لكل طلب مدفوع"
                loading={trendLoading}
              />
            </div>

            <div className="surface min-w-0 rounded-2xl p-4 shadow-card sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-[15px] font-bold">صافي المبيعات والربح يومًا بيوم</h3>
                <span className="text-xs text-muted">
                  {shortDay(span.from)} – {shortDay(span.to)}
                </span>
              </div>
              {trendLoading ? (
                <div aria-hidden className="surface-2 mt-3 h-[272px] animate-pulse rounded-xl" />
              ) : (tt?.orders ?? 0) === 0 ? (
                <p className="surface-2 mt-3 rounded-xl px-3.5 py-3 text-sm leading-6 text-muted">
                  لا مبيعات في آخر 14 يومًا.
                </p>
              ) : (
                <div className="mt-3">
                  <SalesChart points={points} />
                </div>
              )}
            </div>
            <p className="text-xs text-muted">بالدولار، صافي بعد الاسترجاع والطلبات التي لم تُسلَّم.</p>
          </>
        )}
      </section>

      {/* what visitors ran into: errors today, searches that found nothing this week */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-bold">من المتجر</h2>
        <LearnCard />
      </section>

      {!ov.error && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="surface rounded-2xl p-4 shadow-card sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold">مخزون الأكواد منخفض</h2>
              <span className="text-xs text-muted">{LOW_STOCK} أكواد أو أقل</span>
            </div>
            {loading && <p className="mt-3 text-sm text-muted">…</p>}
            {d && d.lowStock.length === 0 && (
              <p className="mt-3 text-sm text-muted">كل المنتجات ذات المخزون فيها ما يكفي.</p>
            )}
            <div className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
              {d?.lowStock.slice(0, allStock ? undefined : CAP).map((p) => (
                <Link
                  key={p.productId}
                  href={`/products/${p.productId}`}
                  className="flex items-center justify-between gap-3 py-2.5 text-sm hover:opacity-80"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{p.nameAr}</span>
                    <span className="block text-xs text-muted" dir="ltr">
                      {p.sku}
                    </span>
                  </span>
                  <span
                    className={`flex-none whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
                      p.available === 0 ? 'bg-bad/12 text-bad' : 'bg-warn/12 text-warn'
                    }`}
                  >
                    {p.available === 0 ? 'نفد' : `${num(p.available)} متبقٍّ`}
                  </span>
                </Link>
              ))}
            </div>
            <ShowAll total={d?.lowStock.length ?? 0} open={allStock} onToggle={() => setAllStock((v) => !v)} />
          </section>

          <section className="surface rounded-2xl p-4 shadow-card sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold">تنبيهات الهامش</h2>
              <span className="text-xs text-muted">أقل من {TARGET_MARGIN}% أو بخسارة</span>
            </div>
            {loading && <p className="mt-3 text-sm text-muted">…</p>}
            {d && d.marginAlerts.length === 0 && (
              <p className="mt-3 text-sm text-muted">لا منتج يُباع بهامش ضعيف.</p>
            )}
            <div className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
              {d?.marginAlerts.slice(0, allMargin ? undefined : CAP).map((p) => {
                const loss = n(p.sellPrice) < n(p.costPrice);
                return (
                  <div key={p.productId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{p.nameAr}</span>
                      <span className="block text-xs text-muted">
                        بيع <span className="tnum">{money(p.sellPrice)}</span> · تكلفة{' '}
                        <span className="tnum">{money(p.costPrice)}</span>
                      </span>
                    </span>
                    <span className="flex flex-none items-center gap-2">
                      <span
                        className={`tnum whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
                          loss ? 'bg-bad/12 text-bad' : 'bg-warn/12 text-warn'
                        }`}
                        dir="ltr"
                      >
                        {n(p.marginPercent).toFixed(1)}%
                      </span>
                      <Link
                        href={`/products/${p.productId}`}
                        className="inline-flex min-h-9 items-center px-1 text-xs font-bold text-teal hover:underline"
                      >
                        إصلاح
                      </Link>
                    </span>
                  </div>
                );
              })}
            </div>
            <ShowAll total={d?.marginAlerts.length ?? 0} open={allMargin} onToggle={() => setAllMargin((v) => !v)} />
          </section>
        </div>
      )}
    </div>
  );
}
