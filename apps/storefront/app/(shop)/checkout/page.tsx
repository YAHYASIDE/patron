'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop, ApiError } from '@/lib/api';
import { cart } from '@/lib/cart';
import { useCart } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order, Quote } from '@/lib/types';
import { CheckIcon, BoltIcon } from '@/components/icons';

const GATEWAY_LABELS: Record<string, string> = {
  WALLET: 'رصيد المحفظة',
  STRIPE: 'بطاقة بنكية (Stripe)',
  MANUAL: 'تحويل يدوي',
  CASH: 'نقدًا',
};
function gatewayLabel(g: string) {
  return GATEWAY_LABELS[g] ?? g;
}

type Step = 'loading' | 'review' | 'working' | 'done' | 'empty';

export default function CheckoutPage() {
  const router = useRouter();
  const { total } = useCart();
  const [step, setStep] = useState<Step>('loading');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [methods, setMethods] = useState<string[]>([]);
  const [gateway, setGateway] = useState<string>('');
  const [coupon, setCoupon] = useState('');
  const [error, setError] = useState<string | null>(null);

  // auth guard
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/checkout');
  }, [router]);

  // build a quote from the cart on load (and when a coupon is applied)
  async function buildQuote(couponCode?: string) {
    const items = cart.items();
    if (items.length === 0) {
      setStep('empty');
      return;
    }
    setStep('loading');
    setError(null);
    try {
      const q = await shop.quote({
        items: items.map((i) => ({
          productId: i.productId,
          quantity: i.quantity,
          inputs: (i.inputs ?? []).map((x) => ({ key: x.key, value: x.value })),
        })),
        couponCode: couponCode || undefined,
      });
      setQuote(q);
      setStep('review');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login?next=/checkout');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'تعذّر تجهيز الطلب.');
      setStep('review');
    }
  }

  useEffect(() => {
    if (!isAuthed()) return;
    shop.paymentMethods().then((m) => {
      setMethods(m);
      setGateway(m.includes('WALLET') ? 'WALLET' : (m[0] ?? ''));
    }).catch(() => setMethods([]));
    buildQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeAndPay() {
    if (!quote) return;
    setStep('working');
    setError(null);
    try {
      const o = await shop.createOrder(quote.id);
      setOrder(o);
      // attempt payment
      const pay = await shop.pay(o.id, gateway, typeof window !== 'undefined' ? window.location.origin + '/orders' : undefined);
      if (pay.status === 'REQUIRES_ACTION' && pay.redirectUrl) {
        window.location.href = pay.redirectUrl;
        return;
      }
      // refresh the order to show its final state
      const fresh = await shop.order(o.id).catch(() => o);
      setOrder(fresh);
      cart.clear();
      setStep('done');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === 'INSUFFICIENT_FUNDS' || /funds|رصيد/i.test(err.message)
            ? 'رصيد محفظتك غير كافٍ لإتمام الدفع. اختر وسيلة دفع أخرى أو اشحن محفظتك.'
            : err.message
          : 'تعذّر إتمام الدفع.';
      setError(msg);
      // if the order was created, keep it so the user can retry payment from /orders
      setStep(order ? 'done' : 'review');
    }
  }

  if (step === 'empty') {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <h1 className="text-xl font-extrabold">لا يوجد ما يُدفع</h1>
        <p className="mt-2 text-muted">سلّتك فارغة.</p>
        <Link href="/products" className="btn-brand mt-6 inline-block rounded-xl px-6 py-3 font-bold">
          تصفّح المنتجات
        </Link>
      </div>
    );
  }

  if (step === 'done') {
    const paid = order?.status === 'PAID' || order?.status === 'COMPLETED' || !!order?.paidAt;
    return (
      <div className="mx-auto max-w-page px-4 py-12">
        <div className="mx-auto max-w-[520px] text-center">
          <div className={'mx-auto grid h-16 w-16 place-items-center rounded-2xl ' + (paid ? 'bg-ok/10 text-ok' : 'bg-warn/10 text-warn')}>
            {paid ? <CheckIcon size={30} /> : <BoltIcon size={28} />}
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">{paid ? 'تم استلام طلبك!' : 'تم إنشاء طلبك'}</h1>
          <p className="mt-2 text-muted">
            رقم الطلب: <span className="font-bold text-[rgb(var(--text))]" dir="ltr">{order?.orderNumber}</span>
          </p>
          {error && (
            <p className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">{error}</p>
          )}
          {!paid && !error && (
            <p className="mt-4 text-sm text-muted">سيكتمل الطلب بمجرّد تأكيد الدفع.</p>
          )}
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={`/orders`} className="btn-brand rounded-xl px-6 py-3 font-bold">
              عرض طلباتي
            </Link>
            <Link
              href="/products"
              className="rounded-xl border border-[rgb(var(--line))] px-6 py-3 font-bold text-muted transition hover:text-[rgb(var(--text))]"
            >
              مواصلة التسوّق
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">إتمام الدفع</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* summary */}
        <div className="lg:col-span-2">
          <div className="surface rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">ملخّص الطلب</h2>
            {step === 'loading' && <p className="mt-4 text-sm text-muted">جارٍ تجهيز السعر…</p>}
            {quote && (
              <div className="mt-4 divide-y divide-[rgb(var(--line))]">
                {quote.items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-[15px] font-bold">{it.productNameAr || it.productNameEn}</div>
                      <div className="text-xs text-muted">الكمية: {it.quantity}</div>
                      {(it.inputs?.length ?? 0) > 0 && (
                        <div className="mt-0.5 text-xs text-muted">{it.inputs!.map((x) => x.value).join(' · ')}</div>
                      )}
                    </div>
                    <div className="tnum font-bold">{money(it.lineTotal, quote.currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* payment method */}
          {methods.length > 0 && (
            <div className="surface mt-4 rounded-2xl p-5 shadow-card">
              <h2 className="text-base font-bold">وسيلة الدفع</h2>
              <div className="mt-3 flex flex-col gap-2">
                {methods.map((m) => (
                  <label
                    key={m}
                    className={
                      'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ' +
                      (gateway === m ? 'border-teal bg-teal/5' : 'border-[rgb(var(--line))]')
                    }
                  >
                    <input
                      type="radio"
                      name="gateway"
                      checked={gateway === m}
                      onChange={() => setGateway(m)}
                      className="accent-teal"
                    />
                    <span className="text-[15px] font-semibold">{gatewayLabel(m)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* totals + pay */}
        <div className="lg:col-span-1">
          <div className="surface sticky top-20 rounded-2xl p-5 shadow-card">
            {/* coupon */}
            <div className="flex gap-2">
              <input
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="كود خصم"
                className="surface-2 hairline w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
              />
              <button
                onClick={() => buildQuote(coupon)}
                className="rounded-xl border border-[rgb(var(--line))] px-3 py-2 text-sm font-bold"
              >
                تطبيق
              </button>
            </div>

            {quote && (
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="المجموع" value={money(quote.subtotal, quote.currency)} />
                {parseFloat(quote.discount) > 0 && (
                  <Row label="الخصم" value={`- ${money(quote.discount, quote.currency)}`} accent="ok" />
                )}
                {parseFloat(quote.fees) > 0 && <Row label="رسوم" value={money(quote.fees, quote.currency)} />}
                {parseFloat(quote.taxAmount) > 0 && <Row label="ضريبة" value={money(quote.taxAmount, quote.currency)} />}
                <div className="flex items-center justify-between border-t border-[rgb(var(--line))] pt-3">
                  <span className="font-bold">الإجمالي</span>
                  <span className="tnum text-xl font-extrabold text-teal">{money(quote.total, quote.currency)}</span>
                </div>
              </dl>
            )}

            {!quote && step !== 'loading' && (
              <p className="mt-4 tnum text-sm text-muted">الإجمالي التقديري: {money(total.amount, total.currency)}</p>
            )}

            {error && step === 'review' && (
              <p role="alert" className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
                {error}
              </p>
            )}

            <button
              onClick={placeAndPay}
              disabled={!quote || step === 'working' || !gateway}
              className="btn-brand mt-5 w-full rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
            >
              {step === 'working' ? 'جارٍ المعالجة…' : 'ادفع الآن'}
            </button>
            <p className="mt-3 text-center text-xs text-muted">بالضغط على «ادفع الآن» فأنت توافق على الشروط.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: 'ok' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={'tnum font-semibold ' + (accent === 'ok' ? 'text-ok' : '')}>{value}</span>
    </div>
  );
}
