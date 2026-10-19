'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAuthed, shop, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { ChevronIcon, CheckIcon } from '@/components/icons';
import { PayOrder } from '@/components/PayOrder';
import OrderTimeline from '@/components/OrderTimeline';
import Guide from '@/components/Guide';
import { reorder } from '@/lib/reorder';
import { useCurrency } from '@/lib/currency';
import { useT, useLang } from '@/lib/i18n';

const STATUS: Record<string, { t: string; c: string }> = {
  COMPLETED: { t: 'مكتمل', c: 'bg-ok/12 text-ok' },
  PAID: { t: 'مدفوع', c: 'bg-ok/12 text-ok' },
  PROCESSING: { t: 'قيد المعالجة', c: 'bg-teal/12 text-teal' },
  DELIVERED: { t: 'تم التسليم', c: 'bg-ok/12 text-ok' },
  PENDING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  PENDING: { t: 'بانتظار', c: 'bg-ink-400/15 text-muted' },
  PARTIALLY_COMPLETED: { t: 'مكتمل جزئيًا', c: 'bg-teal/12 text-teal' },
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
  const t = useT();
  const lang = useLang();
  const payWith = useSearchParams().get('pay') ?? undefined;
  useEffect(() => {
    if (!isAuthed()) router.replace(`/login?next=/orders/${id}`);
  }, [router, id]);

  const res = useFetch<Order>(() => shop.order(id), [id]);
  const order = res.data;
  const currency = useCurrency();
  const [again, setAgain] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });

  // same items, same player ID, today's prices
  async function buyAgain() {
    if (!order) return;
    setAgain({ busy: true, note: null });
    const r = await reorder(order, currency);
    if (r.fillIn) return router.push(`/products/${r.fillIn}`);
    if (r.added > 0) return router.push('/cart');
    setAgain({
      busy: false,
      note: r.unavailable.length
        ? t('غير متوفّر حاليًا: {items}', { items: r.unavailable.join(lang === 'ar' ? '، ' : ', ') })
        : t('تعذّر إعادة الطلب.'),
    });
  }

  const [codes, setCodes] = useState<Record<string, { resultType: string; value: string }[]>>({});
  const [revealing, setRevealing] = useState<string | null>(null);
  const [revealErr, setRevealErr] = useState<Record<string, string>>({});

  async function reveal(itemId: string) {
    setRevealing(itemId);
    setRevealErr((e) => ({ ...e, [itemId]: '' }));
    try {
      const out = await shop.reveal(itemId);
      setCodes((c) => ({ ...c, [itemId]: out }));
    } catch (err) {
      setRevealErr((e) => ({
        ...e,
        [itemId]: err instanceof ApiError ? err.message : t('تعذّر إظهار الكود.'),
      }));
    } finally {
      setRevealing(null);
    }
  }

  if (res.loading && !order)
    return <div className="mx-auto max-w-page px-4 py-16 text-center text-muted">{t('جارٍ التحميل…')}</div>;
  if (res.error || !order)
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <p className="text-muted">{res.error ?? t('الطلب غير موجود.')}</p>
        <Link href="/orders" className="mt-4 inline-block font-bold text-teal hover:underline">
          {t('طلباتي')}
        </Link>
      </div>
    );

  const c = chip(order.status);

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/orders" className="hover:text-[rgb(var(--text))]">
          {t('طلباتي')}
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
          <span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${c.c}`}>
            {t(c.t)}
          </span>
        </div>
        <div className="text-end">
          <div className="text-sm text-muted">{t('الإجمالي')}</div>
          <div className="tnum text-2xl font-extrabold text-teal">{money(order.total, order.currency)}</div>
        </div>
      </div>

      <OrderTimeline order={order} />

      {/* items */}
      <div className="mt-6 space-y-3">
        {order.items.map((it) => {
          const delivered =
            it.status === 'DELIVERED' ||
            it.status === 'COMPLETED' ||
            (it.results?.some((r) => r.hasValue) ?? false);
          const shown = codes[it.id];
          return (
            <div key={it.id} className="surface rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-bold">
                    {lang === 'ar'
                      ? it.productNameAr || it.productNameEn
                      : it.productNameEn || it.productNameAr}
                  </div>
                  <div className="text-xs text-muted">
                    {t('الكمية: {n}', { n: it.quantity })} · {money(it.lineTotal, order.currency)}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip(it.status).c}`}>
                  {t(chip(it.status).t)}
                </span>
              </div>

              {shown ? (
                <div className="mt-3 space-y-2">
                  {shown.map((r, i) => (
                    // a code reads left to right in a monospace face; a message from the shop is plain text
                    <div
                      key={i}
                      dir={r.resultType === 'message' ? undefined : 'ltr'}
                      className={
                        'surface-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[15px] font-bold ' +
                        (r.resultType === 'message' ? '' : 'font-mono')
                      }
                    >
                      <span className="select-all break-words">{r.value}</span>
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
                  {revealing === it.id ? t('جارٍ…') : t('إظهار الكود')}
                </button>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {order.status === 'PENDING_PAYMENT'
                    ? t('يُسلَّم هنا بعد تأكيد الدفع.')
                    : t('نجهّز طلبك الآن، وسيظهر الكود هنا بمجرّد تسليمه.')}
                </p>
              )}

              {delivered && !!it.guide?.after?.length && (

                <div className="mt-3">

                  <Guide title="طريقة الاستخدام" steps={it.guide.after} tone="ok" />

                </div>

              )}

              {revealErr[it.id] && <p className="mt-2 text-sm text-bad">{revealErr[it.id]}</p>}
            </div>
          );
        })}
      </div>

      {order.status === 'PENDING_PAYMENT' && (
        <PayOrder order={order} initial={payWith} onChange={res.reload} />
      )}

      {order.status !== 'PENDING_PAYMENT' && (
        <div className="mt-6">
          <button
            onClick={buyAgain}
            disabled={again.busy}
            className="surface hairline w-full rounded-xl border py-3 text-[15px] font-bold text-teal transition hover:border-teal disabled:opacity-60 sm:w-auto sm:px-8"
          >
            {again.busy ? t('جارٍ التجهيز…') : t('اطلب مجددًا')}
          </button>
          {again.note && <p className="mt-2 text-sm text-bad">{again.note}</p>}
        </div>
      )}
    </div>
  );
}
