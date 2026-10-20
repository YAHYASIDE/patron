'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime, moneyIn, num } from '@/lib/format';
import CopyButton from '@/components/CopyButton';
import Notice from '@/components/Notice';
import { ACTION_LABEL, NETWORK_LABEL, STATUS, txidProblem, type UsdtDetail } from '../shared';

const input = 'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal';

/**
 * One USDT order for staff: who, how much, where to send it (copyable), the
 * receipt, and the three decisions: approve the payment, record the TXID of
 * the transfer you made by hand, or reject with a reason.
 */
export default function UsdtOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const res = useFetch<UsdtDetail>(`/admin/usdt/orders/${id}`);
  const [order, setOrder] = useState<UsdtDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);
  const [txid, setTxid] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  useEffect(() => {
    if (res.data) setOrder(res.data);
  }, [res.data]);

  if (res.error) return <Notice text={res.error} />;
  if (!order) return <div className="surface rounded-2xl p-5 text-sm text-muted shadow-card">جارٍ التحميل…</div>;

  async function act(path: string, body: unknown, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      setOrder(await api.post<UsdtDetail>(`/admin/usdt/orders/${id}/${path}`, body));
      setMsg({ text: done, tone: 'ok' });
      setTxid('');
      setReason('');
      setRejecting(false);
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'تعذّر تنفيذ العملية', tone: 'bad' });
      res.reload();
    } finally {
      setBusy(false);
    }
  }

  const s = order.status;
  const destination = order.delivery === 'BINANCE' ? order.binanceId : order.address;
  const txProblem = txid ? txidProblem(order, txid) : null;
  const canReject = s === 'AWAITING_PAYMENT' || s === 'UNDER_REVIEW' || s === 'READY_TO_SEND';

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex items-center gap-1.5 text-sm text-muted">
        <Link href="/usdt" className="hover:text-[rgb(var(--text))]">
          طلبات USDT
        </Link>
        <span>/</span>
        <span dir="ltr" className="truncate text-[rgb(var(--text))]">
          {order.number}
        </span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="tnum text-2xl font-extrabold">{num(order.amountUsdt, 2)} USDT</h1>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS[s].cls}`}>{STATUS[s].label}</span>
      </div>

      {msg && <Notice text={msg.text} tone={msg.tone} />}

      <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">أين يُرسل</h2>
        <div className="text-sm">
          {order.delivery === 'BINANCE' ? (
            <b>تحويل داخلي في Binance (UID أو بريد أو هاتف)</b>
          ) : (
            <>
              الشبكة:{' '}
              <b dir="ltr" className="text-teal">
                {order.network ? NETWORK_LABEL[order.network] : '—'}
              </b>
            </>
          )}
        </div>
        <div className="surface-2 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5">
          <span dir="ltr" className="min-w-0 select-all break-all font-mono text-sm font-bold">
            {destination}
          </span>
          {destination && <CopyButton text={destination} />}
        </div>
        {order.network && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">الشبكة:</span>
            <span dir="ltr" className="font-mono text-xs font-bold">
              {order.network}
            </span>
            <CopyButton text={order.network} label="نسخ الشبكة" />
          </div>
        )}
        <p className="rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-xs leading-relaxed">
          أرسل من محفظتك على نفس الشبكة بالضبط، وانسخ العنوان ولا تكتبه بيدك. الإرسال على شبكة أخرى يضيّع المبلغ.
        </p>
      </section>

      <section className="surface grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl p-5 text-sm shadow-card sm:grid-cols-4">
        <Info label="الكمية" value={`${num(order.amountUsdt, 2)} USDT`} />
        <Info label="السعر" value={`1 USDT = ${moneyIn(order.rate, order.currency)}`} />
        <Info label="الرسوم" value={moneyIn(order.fee, order.currency)} />
        <Info label="المجموع المطلوب" value={moneyIn(order.total, order.currency)} strong />
        <Info label="الزبون" value={order.user?.fullName ?? '—'} />
        <Info label="واتساب" value={order.user?.phone ?? '—'} ltr />
        <Info label="رقمه موثّق" value={order.user?.phoneVerifiedAt ? 'نعم' : 'لا'} />
        <Info label="طلبات USDT مكتملة سابقًا" value={String(order.previousCompleted)} />
        <Info label="أُنشئ" value={dateTime(order.createdAt)} />
        {order.expiresAt && s === 'AWAITING_PAYMENT' && <Info label="آخر أجل للدفع" value={dateTime(order.expiresAt)} />}
        {order.reviewedBy && <Info label="راجعه" value={order.reviewedBy.fullName} />}
        {order.txid && <Info label="TXID" value={order.txid} ltr mono />}
        {order.rejectReason && <Info label="سبب الرفض" value={order.rejectReason} />}
      </section>

      {order.paymentMethod && (
        <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">الدفع الذي أبلغ عنه الزبون</h2>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <Info label="الوسيلة" value={order.paymentMethod} />
            <Info label="حوّل من" value={order.payerPhone ?? '—'} ltr />
            <Info label="رقم العملية" value={order.paymentRef ?? '—'} ltr />
            <Info label="أبلغ في" value={dateTime(order.paidAt)} />
          </div>
          {order.hasProof && <UsdtReceipt orderId={order.id} />}
          <p className="text-xs text-muted">
            تأكّد من وصول <b className="tnum">{moneyIn(order.total, order.currency)}</b> إلى حسابك في {order.paymentMethod} قبل الموافقة.
          </p>
        </section>
      )}

      <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">الإجراء</h2>
        {s === 'UNDER_REVIEW' && (
          <button
            disabled={busy}
            onClick={() => {
              if (window.confirm('هل وصل المبلغ كاملًا إلى حسابك؟')) act('approve', {}, 'تمت الموافقة. أرسل USDT الآن ثم سجّل رقم العملية.');
            }}
            className="rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
          >
            وصل المبلغ: جاهز للإرسال
          </button>
        )}

        {s === 'READY_TO_SEND' && (
          <div className="flex flex-col gap-2">
            <label htmlFor="txid" className="text-sm font-bold">
              بعد أن ترسل {num(order.amountUsdt, 2)} USDT من محفظتك، الصق رقم العملية (TXID)
            </label>
            <input
              id="txid"
              className={`${input} font-mono text-sm`}
              dir="ltr"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder={order.delivery === 'BINANCE' ? 'Binance transfer id' : order.network === 'TRC20' ? '64 hex' : '0x…'}
              autoComplete="off"
              spellCheck={false}
            />
            {txProblem && <p className="text-xs font-semibold text-bad">{txProblem}</p>}
            <button
              disabled={busy || !txid || !!txProblem}
              onClick={() => act('complete', { txid: txid.trim() }, 'سُجّل الإرسال. يرى الزبون رقم العملية الآن.')}
              className="rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
            >
              سجّل الإرسال وأكمل الطلب
            </button>
          </div>
        )}

        {canReject &&
          (rejecting ? (
            <div className="flex flex-col gap-2">
              <textarea
                className={input}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={300}
                placeholder="سبب الرفض (يراه الزبون)"
              />
              {s !== 'AWAITING_PAYMENT' && order.paidAt && (
                <p className="text-xs text-warn">إن كان المبلغ قد وصلك فأعده للزبون بنفس الطريقة.</p>
              )}
              <div className="flex gap-2">
                <button
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => act('reject', { reason: reason.trim() }, 'رُفض الطلب.')}
                  className="flex-1 rounded-xl bg-bad py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  تأكيد الرفض
                </button>
                <button onClick={() => setRejecting(false)} className="surface-2 rounded-xl px-4 text-sm font-bold text-muted">
                  رجوع
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setRejecting(true)} className="rounded-xl border border-bad/40 py-2.5 text-sm font-bold text-bad">
              رفض الطلب
            </button>
          ))}

        {!canReject && <p className="text-sm text-muted">لا إجراء مطلوب: الطلب في حالة نهائية.</p>}
        {s === 'AWAITING_PAYMENT' && <p className="text-xs text-muted">الزبون لم يبلغ عن الدفع بعد.</p>}
      </section>

      <section className="surface rounded-2xl p-5 shadow-card">
        <h2 className="text-base font-bold">سجل الطلب</h2>
        <ol className="mt-3 flex flex-col gap-2.5 text-sm">
          {order.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5 border-b border-[rgb(var(--line))] pb-2 last:border-0">
              <span>
                <b>{ACTION_LABEL[e.action] ?? e.action}</b>
                {e.actorName && <span className="text-muted"> · {e.actorName}</span>}
                {e.note && <span className="text-muted"> · {e.note}</span>}
                {typeof e.data?.txid === 'string' && (
                  <span dir="ltr" className="block break-all font-mono text-xs text-muted">
                    {e.data.txid}
                  </span>
                )}
              </span>
              <span className="text-xs text-muted">{dateTime(e.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Info({ label, value, strong, ltr, mono }: { label: string; value: string; strong?: boolean; ltr?: boolean; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-xs text-muted">{label}</span>
      <span dir={ltr ? 'ltr' : undefined} className={`break-all text-start ${strong ? 'font-extrabold text-teal' : 'font-semibold'} ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}

/** The customer's screenshot, fetched with the staff token; tap for full size. */
function UsdtReceipt({ orderId }: { orderId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let made: string | null = null;
    api
      .imageUrl(`/admin/usdt/orders/${orderId}/proof`)
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [orderId]);

  if (error) return <p className="text-xs text-muted">صورة التحويل: {error}</p>;
  if (!url) return <p className="text-xs text-muted">جارٍ تحميل صورة التحويل…</p>;
  return (
    <>
      <button onClick={() => setBig(true)} className="flex items-center gap-3 text-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
        <img src={url} alt="صورة التحويل" className="h-28 w-24 rounded-xl border border-[rgb(var(--line))] object-cover" />
        <span className="text-sm font-bold text-teal">عرض صورة التحويل</span>
      </button>
      {big && (
        <div onClick={() => setBig(false)} className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" role="dialog" aria-label="صورة التحويل">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={url} alt="صورة التحويل" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </>
  );
}
