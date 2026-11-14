'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, NOT_READY, isNotReady } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { moneyIn, dateTime, statusChip, paymentChip, GATEWAY_LABEL } from '@/lib/format';
import Receipt from '@/components/Receipt';

type Transfer = {
  method: string;
  reference?: string;
  payerName?: string;
  payerPhone?: string;
  hasProof?: boolean;
  submittedAt: string;
};
type Review = { decision: 'approved' | 'rejected'; at: string; reason?: string };
type Payment = {
  id: string;
  gateway: string;
  status: string;
  amount: string;
  currency: string;
  refundedAmount?: string;
  failureCode?: string | null;
  failureReason?: string | null;
  createdAt: string;
  transfer: Transfer | null;
  review: Review | null;
};
type Item = {
  id: string;
  productNameAr: string;
  quantity: number;
  lineTotal: string;
  status: string;
  product?: { sku: string; delivery: string; _count?: { codes: number } };
  inputs: { fieldKey: string; fieldLabel: string; value: string }[];
  results: { id: string; resultType: string; revealed: boolean; deliveredAt: string }[];
};
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
  paidAt?: string | null;
  user: {
    id?: string;
    email: string | null;
    fullName: string;
    phone?: string | null;
    phoneVerifiedAt?: string | null;
  };
  items: Item[];
  payments: Payment[];
  refunds?: RefundRow[];
  /** What can still be refunded (order total less every refund not rejected). */
  refundable?: string;
  /** How the order was paid, which decides where a refund can go. */
  refundGateway?: string | null;
  adminNote?: string | null;
};
type RefundRow = {
  id: string;
  amount: string;
  currency: string;
  reason: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'PROCESSED';
  toWallet: boolean;
  gatewayRef: string | null;
  createdAt: string;
  processedAt: string | null;
  requestedBy?: { fullName: string } | null;
  processedBy?: { fullName: string } | null;
};
type Template = { id: string; title: string; body: string };

// where the customer sees their order (for the WhatsApp message)
const STORE_URL = (process.env.NEXT_PUBLIC_STORE_URL ?? 'https://etssadagha-store.onrender.com').replace(
  /\/+$/,
  '',
);

/** The customer's WhatsApp, opened on a message that hands over the order. */
function deliveryMessage(order: Order, item: Item, codes: string[]): string | null {
  if (!order.user.phone) return null;
  const lines = [
    `مرحبًا ${order.user.fullName}،`,
    `طلبك ${order.orderNumber} جاهز.`,
    codes.length ? `${item.productNameAr}:` : `${item.productNameAr} ×${item.quantity}`,
    ...codes,
    `تجده أيضًا في صفحة طلبك: ${STORE_URL}/orders/${order.id}`,
    'شكرًا لتسوّقك من patron.',
  ];
  return `https://wa.me/${order.user.phone.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`;
}

const DELIVERABLE_ORDER = ['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'FAILED'];
const DELIVERABLE_ITEM = ['PENDING', 'PROCESSING', 'FAILED'];

function waLink(phone: string) {
  return `https://wa.me/${phone.replace(/[^\d]/g, '')}`;
}

function ErrorBox({ text }: { text: string }) {
  return <p className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{text}</p>;
}

function friendly(err: unknown): string {
  if (!(err instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  const m = err.message;
  if (/already been reviewed/i.test(m)) return 'هذه الدفعة رُوجعت مسبقًا.';
  if (/submitted its reference/i.test(m)) return 'لم يرسل الزبون تحويله بعد.';
  if (/Illegal order transition PENDING_PAYMENT|CANCELLED/i.test(m))
    return 'الطلب أُلغي، لا يمكن تأكيد دفعه.';
  if (/already delivered/i.test(m)) return 'هذا المنتج سُلّم مسبقًا.';
  if (/not paid yet/i.test(m)) return 'أكّد الدفع أولًا ثم سلّم.';
  if (/exceeds order total/i.test(m)) return 'المبلغ أكبر مما بقي قابلًا للاسترجاع في هذا الطلب.';
  if (/no captured payment/i.test(m)) return 'لا توجد دفعة مؤكّدة في هذا الطلب لاسترجاعها.';
  if (/transfer number/i.test(m)) return 'أرسل المبلغ للزبون أولًا، ثم اكتب رقم العملية.';
  if (/Insufficient wallet balance/i.test(m)) return 'رصيد المحفظة لا يكفي.';
  if (err.status === 403) return 'ليست لديك صلاحية لهذا الإجراء.';
  return m;
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, loading, error, reload } = useFetch<Order>(`/admin/orders/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(friendly(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !order) return <p className="text-sm text-muted">جارٍ التحميل…</p>;
  if (error || !order) return <ErrorBox text={error ?? 'الطلب غير موجود.'} />;

  const chip = statusChip(order.status);
  const canDeliver = DELIVERABLE_ORDER.includes(order.status);
  // a transfer waiting for the owner's decision comes first, above everything on a phone
  const awaitingReview = order.payments.some((p) => p.status === 'AUTHORIZED' && p.gateway === 'MANUAL');

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/orders" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
            ← الطلبات
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold" dir="ltr">
            {order.orderNumber}
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}>{chip.label}</span>
            <span className="text-xs text-muted">{dateTime(order.createdAt)}</span>
          </div>
        </div>
        <div className="text-end">
          <div className="text-sm text-muted">الإجمالي</div>
          <div className="tnum text-2xl font-extrabold">{moneyIn(order.total, order.currency)}</div>
        </div>
      </div>

      {actionError && <ErrorBox text={actionError} />}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {/* items */}
          {order.items.map((it) => (
            <ItemCard
              key={it.id}
              item={it}
              canDeliver={canDeliver && DELIVERABLE_ITEM.includes(it.status)}
              orderPaid={canDeliver}
              busy={busy === `deliver-${it.id}` || busy === 'stock'}
              onDeliver={(values, resultType) =>
                act(`deliver-${it.id}`, () =>
                  api.post(`/admin/orders/${order.id}/items/${it.id}/deliver`, { values, resultType }),
                )
              }
              onFromStock={() => act('stock', () => api.post(`/admin/orders/${order.id}/deliver-from-stock`))}
              whatsapp={(codes) => deliveryMessage(order, it, codes)}
            />
          ))}
        </div>

        <div className={`flex flex-col gap-5 ${awaitingReview ? 'order-first lg:order-none' : ''}`}>
          {/* customer */}
          <section className="surface rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">الزبون</h2>
            <div className="mt-3 flex flex-col gap-1.5 text-sm">
              <div className="flex items-center gap-2">
                {order.user.id ? (
                  <Link href={`/customers/${order.user.id}`} className="font-semibold text-teal hover:underline">
                    {order.user.fullName}
                  </Link>
                ) : (
                  <span className="font-semibold">{order.user.fullName}</span>
                )}
                {order.user.phoneVerifiedAt ? (
                  <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-bold text-ok">
                    رقم موثّق
                  </span>
                ) : (
                  <span className="rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-bold text-warn">
                    غير موثّق
                  </span>
                )}
              </div>
              {order.user.email && (
                <div className="text-muted" dir="ltr">
                  {order.user.email}
                </div>
              )}
              {order.user.phone && (
                <a
                  href={waLink(order.user.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-teal hover:underline"
                  dir="ltr"
                >
                  {order.user.phone} · WhatsApp
                </a>
              )}
            </div>
          </section>

          <QuickReplies order={order} />

          <OrderNote orderId={order.id} initial={order.adminNote ?? ''} />

          {/* payments */}
          <section
            className={`surface rounded-2xl p-5 shadow-card ${awaitingReview ? 'order-first border-warn/50' : ''}`}
          >
            <h2 className="text-base font-bold">{awaitingReview ? 'تحويل ينتظر قرارك' : 'الدفع'}</h2>
            {order.payments.length === 0 && (
              <p className="mt-3 text-sm text-muted">لم يبدأ الزبون الدفع بعد.</p>
            )}
            <div className="mt-3 flex flex-col gap-4">
              {order.payments.map((p) => {
                const pc = paymentChip(p.status);
                return (
                  <div
                    key={p.id}
                    className="flex flex-col gap-2 border-t border-[rgb(var(--line))] pt-3 first:border-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{GATEWAY_LABEL[p.gateway] ?? p.gateway}</span>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${pc.cls}`}>
                        {pc.label}
                      </span>
                    </div>
                    {p.transfer && (
                      <dl className="surface-2 flex flex-col gap-1.5 rounded-xl px-3.5 py-3 text-sm">
                        <Line k="الطريقة" v={p.transfer.method} />
                        {p.transfer.payerPhone && <Line k="حوّل من" v={p.transfer.payerPhone} mono />}
                        {p.transfer.reference && <Line k="رقم العملية" v={p.transfer.reference} mono />}
                        {p.transfer.payerName && <Line k="باسم" v={p.transfer.payerName} />}
                        <Line k="أُرسل" v={dateTime(p.transfer.submittedAt)} />
                      </dl>
                    )}
                    {p.transfer?.hasProof && <Receipt paymentId={p.id} />}
                    {p.status === 'AUTHORIZED' && p.gateway === 'MANUAL' && (
                      <>
                        <p className="text-xs text-muted">
                          تحقّق من وصول <b className="tnum">{moneyIn(p.amount, p.currency)}</b> إلى حسابك من الرقم
                          أعلاه ومن صورة التحويل، ثم أكّد.
                        </p>
                        <ReviewButtons
                          busy={busy}
                          paymentId={p.id}
                          onApprove={() => act(`approve-${p.id}`, () => api.post(`/admin/payments/${p.id}/approve`))}
                          onReject={(reason) =>
                            act(`reject-${p.id}`, () => api.post(`/admin/payments/${p.id}/reject`, { reason }))
                          }
                        />
                      </>
                    )}
                    {p.review?.decision === 'rejected' && (
                      <p className="text-xs text-bad">رُفض: {p.review.reason ?? p.failureReason}</p>
                    )}
                    {p.failureCode === 'duplicate_payment' && (
                      <p className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-xs font-semibold text-bad">
                        دفعة ثانية لطلب مدفوع: لم تُحسب، وأعد مبلغها {moneyIn(p.amount, p.currency)} للزبون.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <Refunds order={order} onDone={reload} />
        </div>
      </div>
    </div>
  );
}

const REJECT_REASONS = ['لم يصل المبلغ إلى حسابي', 'المبلغ الذي وصل ناقص', 'صورة التحويل غير واضحة', 'رقم المحوِّل لا يطابق التحويل'];

/** Approve, or reject with a reason the customer will read (ready-made ones, or the owner's own words). */
function ReviewButtons({
  busy,
  paymentId,
  onApprove,
  onReject,
}: {
  busy: string | null;
  paymentId: string;
  onApprove: () => void;
  onReject: (reason: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [own, setOwn] = useState('');
  const text = (reason === 'other' ? own : reason).trim();

  if (!rejecting) {
    return (
      <div className="flex gap-2">
        <button
          disabled={!!busy}
          onClick={() => {
            if (confirm('تأكيد: هل وصلك المبلغ فعلًا؟ سيصبح الطلب مدفوعًا.')) onApprove();
          }}
          className="min-h-11 flex-1 rounded-xl bg-ok py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {busy === `approve-${paymentId}` ? 'جارٍ…' : 'تأكيد الدفع'}
        </button>
        <button
          disabled={!!busy}
          onClick={() => setRejecting(true)}
          className="min-h-11 rounded-xl border border-bad/40 px-4 py-2.5 text-sm font-bold text-bad transition hover:bg-bad/10 disabled:opacity-60"
        >
          رفض
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-bad/30 p-3">
      <p className="text-sm font-bold">سبب الرفض (يقرؤه الزبون)</p>
      {[...REJECT_REASONS, 'other'].map((r) => (
        <label key={r} className="flex min-h-10 items-center gap-2 text-sm">
          <input type="radio" name={`reject-${paymentId}`} checked={reason === r} onChange={() => setReason(r)} />
          {r === 'other' ? 'سبب آخر' : r}
        </label>
      ))}
      {reason === 'other' && (
        <input
          value={own}
          onChange={(e) => setOwn(e.target.value)}
          maxLength={300}
          placeholder="اكتب السبب"
          className="surface-2 hairline rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-teal"
        />
      )}
      <div className="flex gap-2">
        <button
          disabled={!!busy || text.length < 3}
          onClick={() => onReject(text)}
          className="min-h-11 flex-1 rounded-xl bg-bad py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy === `reject-${paymentId}` ? 'جارٍ…' : 'رفض التحويل'}
        </button>
        <button
          onClick={() => setRejecting(false)}
          className="min-h-11 rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold text-muted"
        >
          تراجع
        </button>
      </div>
      <p className="text-xs text-muted">يصل الزبون إشعار بالسبب، ويمكنه الدفع من جديد خلال 30 دقيقة.</p>
    </div>
  );
}

const REFUND_STATUS: Record<RefundRow['status'], { label: string; cls: string }> = {
  REQUESTED: { label: 'ينتظر إرسال المبلغ', cls: 'bg-warn/12 text-warn' },
  APPROVED: { label: 'ينتظر إرسال المبلغ', cls: 'bg-warn/12 text-warn' },
  PROCESSED: { label: 'أُعيد المبلغ', cls: 'bg-ok/12 text-ok' },
  REJECTED: { label: 'أُلغي', cls: 'bg-ink-400/15 text-muted' },
};

/** Read a typed amount: Arabic digits and a comma work too. */
function parseAmount(text: string): number | null {
  const latin = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.').trim();
  if (!/^\d+(\.\d{1,4})?$/.test(latin)) return null;
  const n = Number(latin);
  return n > 0 ? n : null;
}

/**
 * Refunds: full or partial, to the customer's store wallet (instant) or back
 * the way they paid. A transfer refund is the owner sending the money from
 * their own app: it is only marked done once they enter that transfer's number.
 */
function Refunds({ order, onDone }: { order: Order; onDone: () => void }) {
  const refunds = order.refunds ?? [];
  const left = parseFloat(order.refundable ?? '0') || 0;
  const walletOnly = order.refundGateway === 'WALLET';
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [toWallet, setToWallet] = useState(walletOnly);
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = amountText.trim() === '' ? left : parseAmount(amountText);
  const byHand = !toWallet && order.refundGateway === 'MANUAL';
  const ready = amount !== null && amount > 0 && amount <= left + 1e-9 && reason.trim().length >= 3 && (!byHand || reference.trim().length >= 2);

  async function run(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      setOpen(false);
      setAmountText('');
      setReference('');
      setReason('');
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  function submit() {
    if (!ready || amount === null) return;
    run(
      'new',
      async () => {
        const created = await api.post<{ id: string }>('/admin/refunds', {
          orderId: order.id,
          amount: Number(amount.toFixed(4)),
          reason: reason.trim(),
          toWallet,
        });
        await api.post(`/admin/refunds/${created.id}/process`, byHand ? { reference: reference.trim() } : {});
      },
      toWallet ? 'أُضيف المبلغ إلى محفظة الزبون، ووصله إشعار.' : 'سُجّل الاسترجاع، ووصل الزبون إشعار بالمبلغ.',
    );
  }

  if (!refunds.length && left <= 0) return null;

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">الاسترجاع</h2>
        {left > 0 && (
          <span className="text-xs text-muted">
            قابل للاسترجاع: <b className="tnum">{moneyIn(left, order.currency)}</b>
          </span>
        )}
      </div>

      {refunds.length > 0 && (
        <ul className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">
          {refunds.map((r) => {
            const st = REFUND_STATUS[r.status];
            return (
              <li key={r.id} className="flex flex-col gap-1.5 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="tnum font-bold" dir="ltr">
                    {moneyIn(r.amount, r.currency)}
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${st.cls}`}>{st.label}</span>
                </div>
                <span className="text-xs text-muted">
                  {r.toWallet ? 'إلى محفظة الزبون' : 'بتحويل إلى حساب الزبون'} · {r.reason}
                  {r.gatewayRef?.startsWith('manual:') && ` · رقم العملية ${r.gatewayRef.slice(7)}`}
                </span>
                <span className="text-xs text-muted">
                  {dateTime(r.processedAt ?? r.createdAt)}
                  {(r.processedBy ?? r.requestedBy)?.fullName && ` · ${(r.processedBy ?? r.requestedBy)!.fullName}`}
                </span>
                {(r.status === 'REQUESTED' || r.status === 'APPROVED') && (
                  <PendingRefund
                    refund={r}
                    busy={busy}
                    onProcess={(ref) =>
                      run(`p-${r.id}`, () => api.post(`/admin/refunds/${r.id}/process`, { reference: ref }), 'سُجّل الاسترجاع.')
                    }
                    onCancel={() =>
                      run(
                        `x-${r.id}`,
                        () => api.post(`/admin/refunds/${r.id}/reject`, { reason: 'ألغاه المالك قبل الإرسال' }),
                        'أُلغي طلب الاسترجاع.',
                      )
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {msg && (
        <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${msg.ok ? 'bg-ok/10 text-ok' : 'bg-bad/10 text-bad'}`}>{msg.text}</p>
      )}

      {left > 0 && !open && (
        <button
          onClick={() => {
            setOpen(true);
            setToWallet(walletOnly);
          }}
          className="mt-3 min-h-11 w-full rounded-xl border border-[rgb(var(--line))] py-2.5 text-sm font-bold transition hover:border-teal"
        >
          إرجاع مبلغ للزبون
        </button>
      )}

      {left > 0 && open && (
        <div className="mt-3 flex flex-col gap-3 border-t border-[rgb(var(--line))] pt-3">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            المبلغ ({order.currency})
            <input
              inputMode="decimal"
              dir="ltr"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder={String(left)}
              className="surface-2 hairline tnum rounded-xl border px-3 py-2.5 text-base outline-none focus:border-teal"
            />
            <span className="text-xs font-normal text-muted">اتركه فارغًا لإرجاع كامل المتبقي.</span>
          </label>
          {amount === null && amountText.trim() !== '' && <p className="text-xs text-bad">اكتب رقمًا صحيحًا.</p>}
          {amount !== null && amount > left + 1e-9 && (
            <p className="text-xs text-bad">أكبر مما بقي قابلًا للاسترجاع ({moneyIn(left, order.currency)}).</p>
          )}

          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 font-semibold">إلى أين يعود المبلغ؟</legend>
            <label className="flex min-h-10 items-center gap-2">
              <input type="radio" checked={toWallet} onChange={() => setToWallet(true)} />
              محفظة الزبون في المتجر (فوري)
            </label>
            {!walletOnly && (
              <label className="flex min-h-10 items-center gap-2">
                <input type="radio" checked={!toWallet} onChange={() => setToWallet(false)} />
                {order.refundGateway === 'MANUAL' ? 'تحويل إلى حساب الزبون الذي دفع منه' : 'إلى البطاقة'}
              </label>
            )}
          </fieldset>

          {byHand && (
            <label className="flex flex-col gap-1 text-sm font-semibold">
              رقم عملية التحويل الذي أرسلته للزبون
              <input
                dir="ltr"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={120}
                className="surface-2 hairline rounded-xl border px-3 py-2.5 font-mono text-sm outline-none focus:border-teal"
              />
              <span className="text-xs font-normal text-muted">
                أرسل المبلغ أولًا من تطبيقك، ثم اكتب رقم العملية هنا. لن يُسجَّل الاسترجاع بدونه.
              </span>
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm font-semibold">
            السبب (يظهر للزبون)
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              placeholder="مثل: تعذّر توفير المنتج"
              className="surface-2 hairline rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-teal"
            />
          </label>

          <div className="flex gap-2">
            <button
              disabled={!ready || !!busy}
              onClick={submit}
              className="min-h-11 flex-1 rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
            >
              {busy === 'new' ? 'جارٍ…' : `إرجاع ${amount !== null ? moneyIn(amount, order.currency) : ''}`}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold text-muted"
            >
              تراجع
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** A refund recorded but not sent yet (the transfer number was missing): finish it or cancel it. */
function PendingRefund({
  refund,
  busy,
  onProcess,
  onCancel,
}: {
  refund: RefundRow;
  busy: string | null;
  onProcess: (reference: string) => void;
  onCancel: () => void;
}) {
  const [ref, setRef] = useState('');
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warn/40 p-2.5">
      {!refund.toWallet && (
        <input
          dir="ltr"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="رقم عملية التحويل للزبون"
          className="surface-2 hairline rounded-lg border px-3 py-2 font-mono text-sm outline-none focus:border-teal"
        />
      )}
      <div className="flex gap-2">
        <button
          disabled={!!busy || (!refund.toWallet && ref.trim().length < 2)}
          onClick={() => onProcess(ref.trim())}
          className="min-h-10 flex-1 rounded-lg bg-teal px-3 text-sm font-bold text-white disabled:opacity-50"
        >
          {refund.toWallet ? 'أضف إلى المحفظة' : 'أرسلت المبلغ'}
        </button>
        <button
          disabled={!!busy}
          onClick={onCancel}
          className="min-h-10 rounded-lg border border-[rgb(var(--line))] px-3 text-sm font-bold text-muted"
        >
          إلغاء
        </button>
      </div>
    </div>
  );
}

function Line({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={'font-semibold select-all ' + (mono ? 'font-mono' : '')} dir={mono ? 'ltr' : undefined}>
        {v}
      </dd>
    </div>
  );
}

function ItemCard({
  item,
  canDeliver,
  orderPaid,
  busy,
  onDeliver,
  onFromStock,
  whatsapp,
}: {
  item: Item;
  canDeliver: boolean;
  orderPaid: boolean;
  busy: boolean;
  onDeliver: (values: string[], resultType: 'code' | 'message') => void;
  onFromStock: () => void;
  whatsapp: (codes: string[]) => string | null;
}) {
  const [text, setText] = useState('');
  // what was just typed and delivered, so the WhatsApp message can carry it
  const [sent, setSent] = useState<string[]>([]);
  const [sentType, setSentType] = useState<'code' | 'message'>('code');
  const inStock = item.product?._count?.codes ?? 0;
  const [type, setType] = useState<'code' | 'message'>('code');
  const ic = statusChip(item.status);
  const values = text
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
  const manual = item.product?.delivery === 'MANUAL';

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{item.productNameAr}</h2>
          <p className="mt-0.5 text-xs text-muted" dir="ltr">
            {item.product?.sku} · ×{item.quantity}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${ic.cls}`}>{ic.label}</span>
      </div>

      {item.inputs.length > 0 && (
        <dl className="surface-2 mt-3 flex flex-col gap-1.5 rounded-xl px-3.5 py-3 text-sm">
          {item.inputs.map((i) => (
            <Line key={i.fieldKey} k={i.fieldLabel} v={i.value} mono />
          ))}
        </dl>
      )}

      {item.results.length > 0 && (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="text-sm text-ok">
            سُلّم {item.results.length}{' '}
            {item.results.some((r) => r.revealed) ? '· الزبون اطّلع عليه' : '· لم يفتحه الزبون بعد'}
          </p>
          {whatsapp(sent) && (
            <a
              href={whatsapp(sent)!}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-[#1FA855] py-2.5 text-center text-sm font-bold text-white transition hover:opacity-90"
            >
              {!sent.length
                ? 'أرسل للزبون رابط طلبه عبر واتساب'
                : sentType === 'message'
                  ? 'أخبر الزبون عبر واتساب أن طلبه سُلّم'
                  : 'أرسل الكود للزبون عبر واتساب'}
            </a>
          )}
        </div>
      )}

      {canDeliver && inStock >= item.quantity && (
        <button
          onClick={onFromStock}
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
        >
          {busy ? 'جارٍ…' : `سلّم من المخزون (${inStock} متوفّر)`}
        </button>
      )}

      {canDeliver && (
        <div className="mt-4 flex flex-col gap-2.5 border-t border-[rgb(var(--line))] pt-4">
          <label className="text-sm font-semibold">
            {type === 'code'
              ? `الأكواد (كل كود في سطر${item.quantity > 1 ? `، المطلوب ${item.quantity}` : ''})`
              : 'رسالة للزبون'}
          </label>
          <textarea
            rows={Math.min(6, Math.max(2, item.quantity))}
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="ltr"
            placeholder={type === 'code' ? 'XXXX-XXXX-XXXX' : 'تم شحن حسابك بنجاح'}
            className="surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 font-mono text-[15px] outline-none focus:border-teal"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'code' | 'message')}
              className="surface-2 hairline rounded-xl border px-3 py-2 text-sm outline-none"
            >
              <option value="code">كود / بطاقة</option>
              <option value="message">رسالة (شحن مباشر للحساب)</option>
            </select>
            <button
              disabled={busy || values.length === 0}
              onClick={() => {
                if (
                  type === 'code' &&
                  values.length !== item.quantity &&
                  !confirm(`المطلوب ${item.quantity} وأدخلت ${values.length}. المتابعة؟`)
                )
                  return;
                const delivered = type === 'message' ? [text.trim()] : values;
                setSent(delivered);
                setSentType(type);
                onDeliver(delivered, type);
              }}
              className="ms-auto rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ التسليم…' : 'تسليم للزبون'}
            </button>
          </div>
          <p className="text-xs text-muted">يُحفظ مشفّرًا، ويظهر للزبون في صفحة طلبه بزرّ «إظهار الكود».</p>
        </div>
      )}

      {!orderPaid && !item.results.length && manual && (
        <p className="mt-3 text-xs text-muted">يُسلَّم بعد تأكيد الدفع.</p>
      )}
    </section>
  );
}

/** Fill a quick reply's placeholders with this order's details. */
function fill(body: string, order: Order): string {
  return body
    .replaceAll('{name}', order.user.fullName)
    .replaceAll('{order}', order.orderNumber)
    .replaceAll('{link}', `${STORE_URL}/orders/${order.id}`);
}

/** The owner's saved WhatsApp replies (settings), one tap to open the chat with the text ready. */
function QuickReplies({ order }: { order: Order }) {
  const { data, error, loading } = useFetch<Template[]>('/admin/shop/templates');
  const phone = order.user.phone;

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">ردود واتساب السريعة</h2>
        <Link href="/settings#quick-replies" className="text-xs font-bold text-teal hover:underline">
          تعديل
        </Link>
      </div>
      {!phone && <p className="mt-3 text-sm text-muted">لا رقم واتساب لهذا الزبون.</p>}
      {phone && loading && <p className="mt-3 text-sm text-muted">…</p>}
      {phone && error && (
        <p className="mt-3 text-sm text-muted">{error === NOT_READY ? 'الردود السريعة غير متاحة بعد.' : error}</p>
      )}
      {phone && data && data.length === 0 && (
        <p className="mt-3 text-sm text-muted">
          لا ردود محفوظة.{' '}
          <Link href="/settings#quick-replies" className="font-bold text-teal hover:underline">
            أضف ردودًا من الإعدادات
          </Link>
        </p>
      )}
      {phone && data && data.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {data.map((t) => {
            const text = fill(t.body, order);
            return (
              <a
                key={t.id}
                href={`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`}
                target="_blank"
                rel="noopener noreferrer"
                title={text}
                className="hairline flex flex-col rounded-xl border px-3.5 py-2.5 text-start transition hover:border-[#1FA855]"
              >
                <span className="text-sm font-bold">{t.title}</span>
                <span className="line-clamp-2 text-xs text-muted">{text}</span>
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** A note only staff see (e.g. "customer will pay tomorrow"). */
function OrderNote({ orderId, initial }: { orderId: string; initial: string }) {
  const [saved, setSaved] = useState(initial);
  const [note, setNote] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setSaved(initial);
    setNote(initial);
  }, [initial]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.patch<{ adminNote: string | null }>(`/admin/orders/${orderId}/note`, {
        note: note.trim() ? note.trim() : null,
      });
      setSaved(res.adminNote ?? '');
      setNote(res.adminNote ?? '');
      setMsg({ ok: true, text: 'حُفظت الملاحظة.' });
    } catch (e) {
      setMsg({
        ok: false,
        text: isNotReady(e) ? 'الملاحظات غير متاحة بعد.' : friendly(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">ملاحظة داخلية</h2>
      <p className="mt-1 text-xs text-muted">لك ولفريقك فقط، لا تظهر للزبون.</p>
      <textarea
        rows={3}
        maxLength={1000}
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setMsg(null);
        }}
        placeholder="مثال: الزبون سيرسل باقي المبلغ غدًا."
        className="surface-2 hairline mt-3 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-teal"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={save}
          disabled={busy || note === saved}
          className="rounded-xl bg-teal px-5 py-2 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
        >
          {busy ? 'جارٍ…' : 'حفظ الملاحظة'}
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}
