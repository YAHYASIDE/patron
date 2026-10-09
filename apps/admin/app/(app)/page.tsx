'use client';

import { useFetch } from '@/lib/hooks';
import { num, money, date, statusChip } from '@/lib/format';
import Link from 'next/link';

type Dashboard = {
  date?: string;
  today?: {
    orders?: number;
    paidOrders?: number;
    revenueBase?: number | string;
    profitBase?: number | string;
  };
  liveStatuses?: Array<{ status: string; _count?: { status?: number } | number; count?: number }>;
  stuck?: number;
};
type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  total: number | string;
  currency: string;
  createdAt: string;
  user?: { email?: string; fullName?: string };
};
type Paginated<T> = { data: T[]; meta?: Record<string, unknown> };

function countOf(s: { _count?: { status?: number } | number; count?: number }): number {
  if (typeof s._count === 'number') return s._count;
  if (s._count && typeof s._count === 'object') return s._count.status ?? 0;
  return s.count ?? 0;
}

export default function DashboardPage() {
  const dash = useFetch<Dashboard>('/admin/reports/dashboard');
  const orders = useFetch<Paginated<OrderRow>>('/admin/orders?limit=6');
  const products = useFetch<Paginated<unknown>>('/admin/catalog/products?limit=1');

  const today = dash.data?.today ?? {};
  const productTotal = (products.data?.meta?.total as number | undefined) ?? undefined;

  const stats = [
    { k: 'طلبات اليوم', v: num(today.orders ?? 0), hint: 'منذ منتصف الليل' },
    { k: 'مدفوعة اليوم', v: num(today.paidOrders ?? 0), hint: 'طلبات مكتملة الدفع' },
    { k: 'إيراد اليوم', v: money(today.revenueBase ?? 0), hint: 'بالعملة الأساس' },
    { k: 'ربح اليوم', v: money(today.profitBase ?? 0), hint: 'صافي بعد التكلفة' },
    { k: 'إجمالي المنتجات', v: productTotal != null ? num(productTotal) : '—', hint: 'في الكتالوج' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">لوحة القيادة</h1>
          <p className="mt-1 text-sm text-muted">
            {dash.data?.date ? `ملخّص ${date(dash.data.date)}` : 'ملخّص الأداء اليومي'}
          </p>
        </div>
        <button
          onClick={() => {
            dash.reload();
            orders.reload();
            products.reload();
          }}
          className="rounded-xl border border-[rgb(var(--line))] px-3.5 py-2 text-sm font-semibold text-muted transition hover:text-[rgb(var(--text))]"
        >
          تحديث
        </button>
      </div>

      {dash.error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          تعذّر جلب الإحصائيات: {dash.error}
        </div>
      )}

      {/* stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.k} className="surface rounded-2xl p-4 shadow-card">
            <div className="text-[13px] font-semibold text-muted">{s.k}</div>
            <div className="mt-2 text-2xl font-extrabold tnum">
              {dash.loading ? <span className="text-muted">…</span> : s.v}
            </div>
            <div className="mt-1 text-[11.5px] text-muted">{s.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* live statuses */}
        <section className="surface rounded-2xl p-5 shadow-card lg:col-span-2">
          <h2 className="text-base font-bold">حالات الطلبات الآن</h2>
          <div className="mt-4 flex flex-col gap-2.5">
            {dash.loading && <p className="text-sm text-muted">…</p>}
            {!dash.loading && (dash.data?.liveStatuses?.length ?? 0) === 0 && (
              <p className="text-sm text-muted">لا توجد طلبات نشطة.</p>
            )}
            {dash.data?.liveStatuses?.map((s) => {
              const chip = statusChip(s.status);
              return (
                <div key={s.status} className="flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}>
                    {chip.label}
                  </span>
                  <span className="tnum text-sm font-bold">{num(countOf(s))}</span>
                </div>
              );
            })}
            {typeof dash.data?.stuck === 'number' && dash.data.stuck > 0 && (
              <div className="mt-2 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-xs font-semibold text-warn">
                {num(dash.data.stuck)} طلب متعثّر يحتاج مراجعة
              </div>
            )}
          </div>
        </section>

        {/* recent orders */}
        <section className="surface overflow-hidden rounded-2xl shadow-card lg:col-span-3">
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
                  <th className="px-5 py-2.5 text-start text-xs font-semibold">الحالة</th>
                  <th className="px-5 py-2.5 text-start text-xs font-semibold">الإجمالي</th>
                  <th className="px-5 py-2.5 text-start text-xs font-semibold">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {orders.loading && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      …
                    </td>
                  </tr>
                )}
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
                      <td className="px-5 py-3 font-semibold" dir="ltr">
                        {o.orderNumber}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}>
                          {chip.label}
                        </span>
                      </td>
                      <td className="px-5 py-3 tnum">{money(o.total)}</td>
                      <td className="px-5 py-3 text-muted">{date(o.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
