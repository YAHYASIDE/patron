'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isAuthed, shop, me, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order } from '@/lib/types';
import { ChevronIcon, HeadsetIcon } from '@/components/icons';
import { PayOrder } from '@/components/PayOrder';
import OrderTimeline from '@/components/OrderTimeline';
import Guide from '@/components/Guide';
import CodeList, { type Revealed } from '@/components/my/CodeList';
import ReviewForm from '@/components/my/ReviewForm';
import TicketForm from '@/components/my/TicketForm';
import PastPurchases from '@/components/my/PastPurchases';
import { chip, isDelivered } from '@/components/my/status';
import { day } from '@/components/my/when';
import { reorder } from '@/lib/reorder';
import { useCurrency } from '@/lib/currency';
import { useT, useLang } from '@/lib/i18n';

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
  const [problem, setProblem] = useState(false);

  // items already reviewed; null until known (and while the reviews service is unreachable, no form shows)
  const [reviewed, setReviewed] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    me.reviewed()
      .then((ids) => alive && setReviewed(new Set(ids)))
      .catch(() => alive && setReviewed(null));
    return () => {
      alive = false;
    };
  }, [id]);

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

  const [codes, setCodes] = useState<Record<string, Revealed[]>>({});
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
        <ChevronIcon size={14} className="ltr:rotate-180" />
        <span dir="ltr" className="truncate text-[rgb(var(--text))]">
          {order.orderNumber}
        </span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="break-all text-2xl font-extrabold" dir="ltr">
            {order.orderNumber}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${c.c}`}>{t(c.t)}</span>
            <span className="text-xs text-muted">{day(order.createdAt)}</span>
          </div>
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
          const delivered = isDelivered(it);
          const shown = codes[it.id];
          const name = lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr;
          return (
            <div key={it.id} className="surface rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{name}</div>
                  <div className="text-xs text-muted">
                    {t('الكمية: {n}', { n: it.quantity })} · {money(it.lineTotal, order.currency)}
                  </div>
                </div>
                <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${chip(it.status).c}`}>
                  {t(chip(it.status).t)}
                </span>
              </div>

              {shown ? (
                <CodeList values={shown} product={name} />
              ) : delivered ? (
                <button
                  onClick={() => reveal(it.id)}
                  disabled={revealing === it.id}
                  className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60"
                >
                  {revealing === it.id ? t('جارٍ…') : t('إظهار الكود')}
                </button>
              ) : (
                <p className={`mt-3 text-sm ${it.status === 'FAILED' ? 'font-semibold text-bad' : 'text-muted'}`}>
                  {it.status === 'FAILED'
                    ? t('لم نستطع تسليمه تلقائيًا. سنسلّمه يدويًا أو نعيد لك المبلغ كاملًا، ولا داعي للدفع مرة أخرى.')
                    : it.status === 'REFUNDED'
                      ? t('أعدنا لك ثمن هذا البند.')
                      : it.status === 'CANCELLED' || order.status === 'CANCELLED'
                        ? t('أُلغي هذا البند، ولم يُخصم ثمنه.')
                        : order.status === 'PENDING_PAYMENT'
                          ? t('يُسلَّم هنا بعد تأكيد الدفع.')
                          : t('نجهّز طلبك الآن، ويظهر هنا بمجرّد تسليمه مع إشعار لك.')}
                </p>
              )}

              {delivered && !!it.guide?.after?.length && (
                <div className="mt-3">
                  <Guide title="طريقة الاستخدام" steps={it.guide.after} tone="ok" />
                </div>
              )}

              {revealErr[it.id] && <p className="mt-2 text-sm text-bad">{revealErr[it.id]}</p>}

              {it.status === 'DELIVERED' && reviewed && !reviewed.has(it.id) && (
                <ReviewForm
                  orderItemId={it.id}
                  onDone={() => setReviewed((s) => new Set([...(s ?? []), it.id]))}
                />
              )}
            </div>
          );
        })}
      </div>

      {order.status === 'PENDING_PAYMENT' && (
        <PayOrder order={order} initial={payWith} onChange={res.reload} />
      )}

      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {order.status !== 'PENDING_PAYMENT' && (
          <button
            onClick={buyAgain}
            disabled={again.busy}
            className="surface hairline rounded-xl border py-3 text-[15px] font-bold text-teal transition hover:border-teal disabled:opacity-60 sm:px-8"
          >
            {again.busy ? t('جارٍ التجهيز…') : t('اطلب مجددًا')}
          </button>
        )}
        <Link
          href={`/orders/${order.id}/receipt`}
          className="surface hairline rounded-xl border py-3 text-center text-[15px] font-bold transition hover:border-teal sm:px-8"
        >
          {t('الإيصال')}
        </Link>
      </div>
      {again.note && <p className="mt-2 text-sm text-bad">{again.note}</p>}

      {/* #16: a support request about this order */}
      <div className="surface mt-6 rounded-2xl p-4 shadow-card">
        {problem ? (
          <>
            <h2 className="mb-3 text-base font-bold">{t('مشكلة في الطلب؟')}</h2>
            <TicketForm orderId={order.id} orderNumber={order.orderNumber} onCancel={() => setProblem(false)} />
          </>
        ) : (
          <button onClick={() => setProblem(true)} className="flex w-full items-center gap-3 text-start">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal/10 text-teal">
              <HeadsetIcon size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{t('مشكلة في الطلب؟')}</span>
              <span className="block text-sm text-muted">{t('أخبرنا وسنساعدك في أقرب وقت.')}</span>
            </span>
            <ChevronIcon size={16} className="flex-none text-muted ltr:rotate-180" />
          </button>
        )}
      </div>

      {/* #3: everything they bought before */}
      <PastPurchases excludeId={order.id} before={order.createdAt} />
    </div>
  );
}
