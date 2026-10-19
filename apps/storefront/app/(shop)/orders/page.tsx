'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { Cursored, Order } from '@/lib/types';
import { ChevronIcon } from '@/components/icons';
import { useT, useLang } from '@/lib/i18n';

const STATUS: Record<string, { t: string; c: string }> = {
  COMPLETED: { t: 'مكتمل', c: 'bg-ok/12 text-ok' },
  PAID: { t: 'مدفوع', c: 'bg-ok/12 text-ok' },
  PROCESSING: { t: 'قيد المعالجة', c: 'bg-teal/12 text-teal' },
  PENDING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  AWAITING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  FAILED: { t: 'فشل', c: 'bg-bad/12 text-bad' },
  CANCELLED: { t: 'ملغي', c: 'bg-ink-400/15 text-muted' },
  REFUNDED: { t: 'مُسترجع', c: 'bg-ink-400/15 text-muted' },
};
function chip(s: string) {
  return STATUS[s] ?? { t: s, c: 'bg-ink-400/15 text-muted' };
}

export default function OrdersPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/orders');
  }, [router]);

  const res = useFetch<Cursored<Order>>(() => shop.orders({ limit: 20 }), []);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('طلباتي')}</h1>

      {res.loading && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {res.error}
        </div>
      )}

      {!res.loading && (res.data?.data.length ?? 0) === 0 && !res.error && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          {t('لا توجد طلبات بعد.')}{' '}
          <Link href="/products" className="font-bold text-teal hover:underline">
            {t('ابدأ التسوّق')}
          </Link>
        </div>
      )}

      <div className="mt-6 space-y-3">
        {res.data?.data.map((o) => {
          const c = chip(o.status);
          return (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="surface flex items-center justify-between gap-3 rounded-2xl p-4 shadow-card transition hover:shadow-float"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold" dir="ltr">
                    {o.orderNumber}
                  </span>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${c.c}`}>{t(c.t)}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-muted">
                  {o.items
                    .map(
                      (it) =>
                        `${lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr} ×${it.quantity}`,
                    )
                    .join(lang === 'ar' ? '، ' : ', ')}
                </p>
              </div>
              <ChevronIcon className="flex-none text-muted" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
