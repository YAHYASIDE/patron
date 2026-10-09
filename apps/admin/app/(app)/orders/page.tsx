'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { money, date, statusChip } from '@/lib/format';

type OrderRow = {
  id: string;
  orderNumber: string;
  status: string;
  total: number | string;
  currency: string;
  createdAt: string;
  user?: { email?: string; fullName?: string };
};
type OrdersResp = { data: OrderRow[]; meta?: { hasMore: boolean; nextCursor: string | null } };

export default function OrdersPage() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState(true);

  const load = useCallback(async (next: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ limit: '20' });
      if (next) qs.set('cursor', next);
      const resp = await api.get<OrdersResp>(`/admin/orders?${qs.toString()}`);
      setRows((prev) => (next ? [...prev, ...resp.data] : resp.data));
      setHasMore(resp.meta?.hasMore ?? false);
      setCursor(resp.meta?.nextCursor ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'تعذّر جلب الطلبات');
    } finally {
      setLoading(false);
      setFirst(false);
    }
  }, []);

  useEffect(() => {
    load(null);
  }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">الطلبات</h1>
        <p className="mt-1 text-sm text-muted">كل طلبات المتجر، الأحدث أولاً.</p>
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}
        </div>
      )}

      <div className="surface overflow-hidden rounded-2xl shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                {['رقم الطلب', 'العميل', 'الحالة', 'الإجمالي', 'التاريخ'].map((h) => (
                  <th key={h} className="px-5 py-3 text-start text-xs font-semibold">
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
                    لا توجد طلبات بعد.
                  </td>
                </tr>
              )}
              {rows.map((o) => {
                const chip = statusChip(o.status);
                return (
                  <tr key={o.id} className="border-t hairline">
                    <td className="px-5 py-3 font-semibold" dir="ltr">
                      {o.orderNumber}
                    </td>
                    <td className="px-5 py-3 text-muted" dir="ltr">
                      {o.user?.email ?? '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}>
                        {chip.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 tnum font-semibold">{money(o.total)}</td>
                    <td className="px-5 py-3 text-muted">{date(o.createdAt)}</td>
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
