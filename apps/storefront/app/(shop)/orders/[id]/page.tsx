'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { ChevronIcon, CheckIcon } from '@/components/icons';

const STATUS: Record<string, { t: string; c: string }> = {
  COMPLETED: { t: 'مكتمل', c: 'bg-ok/12 text-ok' },
  PAID: { t: 'مدفوع', c: 'bg-ok/12 text-ok' },
  PROCESSING: { t: 'قيد المعالجة', c: 'bg-teal/12 text-teal' },
  DELIVERED: { t: 'تم التسليم', c: 'bg-ok/12 text-ok' },
  PENDING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  AWAITING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  FAILED: { t: 'فشل', c: 'bg-bad/12 text-bad' },
  CANCELLED: { t: 'ملغي', c: 'bg-ink-400/15 text-muted' },
};
function chip(s: string) {
  return STATUS[s] ?? { t: s, c: 'bg-ink-400/15 text-muted' };
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  useEffect(() => {
    if (!isAuthed()) router.replace(`/login?next=/orders/${id}`);
  }, [router, id]);

  const res = useFetch<Order>(() => shop.order(id), [id]);
  const order = res.data;

  const [codes, setCodes] = useState<Record<string, string[]>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [revealErr, setRevealErr] = useState<Record<string, string>>({});

  async function reveal(itemId: string) {
    setRevealing(itemId);
    setRevealErr((e) => ({ ...e, [itemId]: '' }));
    try {
      const out = await shop.reveal(itemId);
      setCodes((c) => ({ ...c, [itemId]: out.map((o) => o.value) }));
    } catch (err) {
      setRevealErr((e) => ({
        ...e,
        [itemId]: err instanceof ApiError ? err.message : 'تعذّر إظهار الكود.',
      }));
    } finally {
      setRevealing(null);
    }
  }

  if (res.loading) return <div className="mx-auto max-w-page px-4 py-16 text-center text-muted">جارٍ التحميل…</div>;
  if (res.error || !order)
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <p className="text-muted">{res.error ?? 'الطلب غير موجود.'}</p>
        <Link href="/orders" className="mt-4 inline-block font-bold text-teal hover:underline">
          طلباتي
        </Link>
      </div>
    );

  const c = chip(order.status);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/orders" className="hover:text-[rgb(var(--text))]">
          طلباتي
        </Link>
        <ChevronIcon size={14} />
        <span dir="ltr" className="text-[rgb(var(--text))]">
          {order.orderNumber}
        </span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold" dir="ltr">
            {order.orderNumber}
          </h1>
          <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${c.c}`}>{c.t}</span>
        </div>
        <div className="text-left">
          <div className="text-sm text-muted">الإجمالي</div>
          <div className="tnum text-2xl font-extrabold text-teal">{money(order.total, order.currency)}</div>
        </div>
      </div>

      {/* items */}
      <div className="mt-6 space-y-3">
        {order.items.map((it) => {
          const delivered = it.status === 'DELIVERED' || it.status === 'COMPLETED' || (it.results?.some((r) => r.hasValue) ?? false);
          const shown = codes[it.id];
          return (
            <div key={it.id} className="surface rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold">{it.productNameAr || it.productNameEn}</div>
                  <div className="text-xs text-muted">
                    الكمية: {it.quantity} · {money(it.lineTotal, order.currency)}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip(it.status).c}`}>
                  {chip(it.status).t}
                </span>
              </div>

              {shown ? (
                <div className="mt-3 space-y-2">
                  {shown.map((code, i) => (
                    <div
                      key={i}
                      dir="ltr"
                      className="surface-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 font-mono text-[15px] font-bold"
                    >
                      <span className="select-all break-all">{code}</span>
                      <CheckIcon size={16} className="flex-none text-ok" />
                    </div>
                  ))}
                </div>
              ) : delivered ? (
                <button
                  onClick={() => reveal(it.id)}
                  disabled={revealing === it.id}
                  className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60"
                >
                  {revealing === it.id ? 'جارٍ…' : 'إظهار الكود'}
                </button>
              ) : (
                <p className="mt-3 text-sm text-muted">يُجهّز هذا المنتج، وستظهر التفاصيل هنا بمجرّد اكتماله.</p>
              )}

              {revealErr[it.id] && <p className="mt-2 text-sm text-bad">{revealErr[it.id]}</p>}
            </div>
          );
        })}
      </div>

      {order.status === 'PENDING_PAYMENT' || order.status === 'AWAITING_PAYMENT' ? (
        <div className="mt-6 rounded-2xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
          هذا الطلب بانتظار الدفع.{' '}
          <Link href="/checkout" className="font-bold underline">
            أكمل الدفع
          </Link>
        </div>
      ) : null}
    </div>
  );
}
