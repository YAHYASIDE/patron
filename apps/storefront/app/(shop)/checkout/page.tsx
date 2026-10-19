'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, shop, ApiError } from '@/lib/api';
import { cart } from '@/lib/cart';
import { useCart } from '@/lib/hooks';
import { money } from '@/lib/format';
import type { Order, Quote } from '@/lib/types';
import { gatewayLabel, useUsableMethods } from '@/lib/payments';
import { getCurrency } from '@/lib/currency';
import { useT, useLang, tNow } from '@/lib/i18n';
import { CheckIcon, BoltIcon, CloseIcon } from '@/components/icons';
import VerifyPanel from '@/components/VerifyPanel';
import PastPurchases from '@/components/my/PastPurchases';

type Step = 'loading' | 'review' | 'working' | 'done' | 'empty' | 'verify';

/**
 * A coupon the quote refused, in plain words (#17). The API answers in English
 * ("This coupon has expired", "Minimum order total for this coupon is 25 USD");
 * null when the error is not about the coupon.
 */
function couponProblem(err: ApiError): string | null {
  const m = err.message;
  if (!/coupon/i.test(m) && !/COUPON/.test(err.code ?? '')) return null;
  if (/expired/i.test(m)) return tNow('انتهت صلاحية هذا الكود.');
  if (/not active yet|not started/i.test(m)) return tNow('هذا الكود لم يبدأ بعد. جرّبه لاحقًا.');
  if (/fully redeemed|no uses left|limit/i.test(m)) return tNow('نفدت مرات استخدام هذا الكود.');
  if (/already used/i.test(m)) return tNow('لقد استخدمت هذا الكود من قبل.');
  const min = m.match(/minimum order total[^\d]*([\d.,]+)\s*([A-Z]{3})?/i);
  if (min) {
    const amount = money(min[1].replace(/,/g, ''), min[2] ?? getCurrency());
    return tNow('هذا الكود لطلب لا يقلّ عن {amount}. أضف منتجًا آخر لتستفيد منه.', { amount });
  }
  return tNow('هذا الكود غير صحيح. تحقّق منه وحاول مجددًا.');
}

export default function CheckoutPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const { total } = useCart();
  const [step, setStep] = useState<Step>('loading');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const usable = useUsableMethods(quote ? Number(quote.total) : null, quote?.currency ?? null);
  const methods = usable ?? [];
  const [gateway, setGateway] = useState<string>('');
  const [coupon, setCoupon] = useState('');
  // the code the current quote carries, and why the last one typed was refused
  const [applied, setApplied] = useState<string | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  // most customers have no code: the field stays a small link until asked for
  const [couponOpen, setCouponOpen] = useState(false);
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
        currency: getCurrency(),
      });
      setQuote(q);
      setApplied(couponCode ? couponCode.toUpperCase() : null);
      setStep('review');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login?next=/checkout');
        return;
      }
      // the owner confirms who buys: verify the WhatsApp number first, then carry on
      if (err instanceof ApiError && err.code === 'PHONE_NOT_VERIFIED') {
        setStep('verify');
        return;
      }
      // a refused coupon must not block the order: say why, and price the cart without it
      const problem = couponCode && err instanceof ApiError ? couponProblem(err) : null;
      if (problem) {
        setCouponError(problem);
        return buildQuote();
      }
      setError(err instanceof ApiError ? err.message : tNow('تعذّر تجهيز الطلب.'));
      setStep('review');
    }
  }

  function applyCoupon() {
    const code = coupon.trim();
    setCouponError(null);
    if (!code) return;
    if (code.length < 3 || code.length > 40) return setCouponError(tNow('هذا الكود غير صحيح. تحقّق منه وحاول مجددًا.'));
    buildQuote(code);
  }

  function removeCoupon() {
    setCoupon('');
    setCouponError(null);
    buildQuote();
  }

  useEffect(() => {
    if (!isAuthed()) return;
    buildQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the choice valid as the offer changes (a coupon can make the wallet enough, or not)
  useEffect(() => {
    if (usable && !usable.includes(gateway)) setGateway(usable.includes('WALLET') ? 'WALLET' : (usable[0] ?? ''));
  }, [usable, gateway]);

  async function placeAndPay() {
    if (!quote) return;
    setStep('working');
    setError(null);
    let created: Order | null = null;
    try {
      const o = await shop.createOrder(quote.id);
      created = o;
      setOrder(o);
      if (gateway === 'MANUAL') {
        // the order page shows the transfer accounts and takes the reference
        cart.clear();
        router.push(`/orders/${o.id}?pay=MANUAL`);
        return;
      }
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
            ? tNow('رصيد محفظتك غير كافٍ لإتمام الدفع. اختر وسيلة دفع أخرى أو اشحن محفظتك.')
            : err.message
          : tNow('تعذّر إتمام الدفع.');
      setError(msg);
      // the order exists: its page lets the customer pay another way
      if (created) {
        cart.clear();
        setStep('done');
        return;
      }
      setStep('review');
    }
  }

  if (step === 'verify') {
    return (
      <div className="mx-auto max-w-page px-4 py-10">
        <div className="surface mx-auto max-w-[460px] rounded-2xl p-5 shadow-card sm:p-6">
          <VerifyPanel
            onVerified={() => setTimeout(() => buildQuote(applied ?? undefined), 1200)}
            onSkip={() => router.push('/products')}
            skipLabel={t('ليس الآن، أكمل التسوّق')}
          />
        </div>
      </div>
    );
  }

  if (step === 'empty') {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <h1 className="text-xl font-extrabold">{t('لا يوجد ما يُدفع')}</h1>
        <p className="mt-2 text-muted">{t('سلّتك فارغة.')}</p>
        <Link href="/products" className="btn-brand mt-6 inline-block rounded-xl px-6 py-3 font-bold">
          {t('تصفّح المنتجات')}
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
          <h1 className="mt-5 text-2xl font-extrabold">{paid ? t('تم استلام طلبك!') : t('تم إنشاء طلبك')}</h1>
          <p className="mt-2 text-muted">
            {t('رقم الطلب:')} <span className="font-bold text-[rgb(var(--text))]" dir="ltr">{order?.orderNumber}</span>
          </p>
          {error && (
            <p className="mt-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">{error}</p>
          )}
          {!paid && !error && (
            <p className="mt-4 text-sm text-muted">{t('سيكتمل الطلب بمجرّد تأكيد الدفع.')}</p>
          )}
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={order ? `/orders/${order.id}` : '/orders'} className="btn-brand rounded-xl px-6 py-3 font-bold">
              {paid ? t('عرض الطلب') : t('أكمل الدفع')}
            </Link>
            <Link
              href="/products"
              className="rounded-xl border border-[rgb(var(--line))] px-6 py-3 font-bold text-muted transition hover:text-[rgb(var(--text))]"
            >
              {t('مواصلة التسوّق')}
            </Link>
          </div>
        </div>
        {/* #3: right after buying, everything they bought before */}
        {order && (
          <div className="mx-auto max-w-[720px]">
            <PastPurchases excludeId={order.id} before={order.createdAt} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('إتمام الدفع')}</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* summary */}
        <div className="lg:col-span-2">
          <div className="surface rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">{t('ملخّص الطلب')}</h2>
            {step === 'loading' && <p className="mt-4 text-sm text-muted">{t('جارٍ تجهيز السعر…')}</p>}
            {quote && (
              <div className="mt-4 divide-y divide-[rgb(var(--line))]">
                {quote.items.map((it, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 py-3">
                    <div>
                      <div className="text-[15px] font-bold">{lang === 'ar' ? it.productNameAr || it.productNameEn : it.productNameEn || it.productNameAr}</div>
                      <div className="text-xs text-muted">{t('الكمية: {n}', { n: it.quantity })}</div>
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
          {quote && usable?.length === 0 && (
            <p className="surface mt-4 rounded-2xl p-5 text-sm text-muted shadow-card">
              {t('لا توجد وسيلة دفع متاحة حاليًا. تواصل مع المتجر.')}
            </p>
          )}
          {methods.length > 0 && (
            <div className="surface mt-4 rounded-2xl p-5 shadow-card">
              <h2 className="text-base font-bold">{t('وسيلة الدفع')}</h2>
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
                    <span className="text-[15px] font-semibold">{gatewayLabel(m, t)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* totals + pay */}
        <div className="lg:col-span-1">
          <div className="surface sticky top-20 rounded-2xl p-5 shadow-card">
            {/* coupon (#17) */}
            {applied && quote ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-ok/30 bg-ok/10 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-bold text-ok">
                    <CheckIcon size={15} />
                    <span dir="ltr" className="break-all">
                      {applied}
                    </span>
                  </span>
                  <span className="block text-xs text-ok">
                    {parseFloat(quote.discount) > 0
                      ? t('وفّرت {amount}', { amount: money(quote.discount, quote.currency) })
                      : t('تم تطبيق الكود')}
                  </span>
                </span>
                <button
                  onClick={removeCoupon}
                  disabled={step === 'loading' || step === 'working'}
                  aria-label={t('إزالة الكود')}
                  className="grid h-8 w-8 flex-none place-items-center rounded-lg text-ok transition hover:bg-ok/15"
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            ) : !couponOpen ? (
              <button
                type="button"
                onClick={() => setCouponOpen(true)}
                className="text-xs font-semibold text-teal hover:underline"
              >
                {t('لديك كود خصم؟')}
              </button>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyCoupon();
                }}
                className="flex gap-2"
              >
                <input
                  value={coupon}
                  onChange={(e) => {
                    setCoupon(e.target.value.toUpperCase());
                    setCouponError(null);
                  }}
                  placeholder={t('كود خصم')}
                  aria-label={t('كود خصم')}
                  aria-invalid={!!couponError}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  className={
                    'surface-2 hairline w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:border-teal ' +
                    (couponError ? 'border-bad/60' : '')
                  }
                />
                <button
                  type="submit"
                  disabled={step === 'loading' || step === 'working' || !coupon.trim()}
                  className="flex-none rounded-lg border border-[rgb(var(--line))] px-2.5 py-1.5 text-xs font-bold disabled:opacity-60"
                >
                  {t('تطبيق')}
                </button>
              </form>
            )}
            {couponError && (
              <p role="alert" className="mt-2 text-xs text-bad">
                {couponError}
              </p>
            )}

            {quote && (
              <dl className="mt-4 space-y-2 text-sm">
                <Row label={t('المجموع')} value={money(quote.subtotal, quote.currency)} />
                {parseFloat(quote.discount) > 0 && (
                  <Row label={t('الخصم')} value={`- ${money(quote.discount, quote.currency)}`} accent="ok" />
                )}
                {parseFloat(quote.fees) > 0 && <Row label={t('رسوم')} value={money(quote.fees, quote.currency)} />}
                {parseFloat(quote.taxAmount) > 0 && <Row label={t('ضريبة')} value={money(quote.taxAmount, quote.currency)} />}
                <div className="flex items-center justify-between border-t border-[rgb(var(--line))] pt-3">
                  <span className="font-bold">{t('الإجمالي')}</span>
                  <span className="tnum text-xl font-extrabold text-teal">{money(quote.total, quote.currency)}</span>
                </div>
              </dl>
            )}

            {!quote && step !== 'loading' && (
              <p className="mt-4 tnum text-sm text-muted">{t('الإجمالي التقديري: {amount}', { amount: money(total.amount, total.currency) })}</p>
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
              {step === 'working' ? t('جارٍ المعالجة…') : gateway === 'MANUAL' ? t('متابعة إلى التحويل') : t('ادفع الآن')}
            </button>
            <p className="mt-3 text-center text-xs text-muted">{t('بالضغط على «ادفع الآن» فأنت توافق على الشروط.')}</p>
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
