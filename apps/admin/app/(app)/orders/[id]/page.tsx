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
  adminNote?: string | null;
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
    'شكرًا لتسوّقك من باترون.',
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

        <div className="flex flex-col gap-5">
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
          <section className="surface rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">الدفع</h2>
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
                        <div className="flex gap-2">
                          <button
                            disabled={!!busy}
                            onClick={() => {
                              if (confirm('تأكيد: هل وصلك المبلغ فعلًا؟ سيصبح الطلب مدفوعًا.'))
                                act(`approve-${p.id}`, () => api.post(`/admin/payments/${p.id}/approve`));
                            }}
                            className="flex-1 rounded-xl bg-ok py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                          >
                            {busy === `approve-${p.id}` ? 'جارٍ…' : 'تأكيد الدفع'}
                          </button>
                          <button
                            disabled={!!busy}
                            onClick={() => {
                              const reason = prompt('سبب الرفض (يظهر للزبون):', 'لم يصل التحويل');
                              if (reason && reason.trim().length >= 3)
                                act(`reject-${p.id}`, () =>
                                  api.post(`/admin/payments/${p.id}/reject`, { reason: reason.trim() }),
                                );
                            }}
                            className="rounded-xl border border-bad/40 px-4 py-2.5 text-sm font-bold text-bad transition hover:bg-bad/10 disabled:opacity-60"
                          >
                            رفض
                          </button>
                        </div>
                      </>
                    )}
                    {p.review?.decision === 'rejected' && (
                      <p className="text-xs text-bad">رُفض: {p.review.reason ?? p.failureReason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
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
              {sent.length ? 'أرسل الكود للزبون عبر واتساب' : 'أرسل للزبون رابط طلبه عبر واتساب'}
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
