'use client';

import { useCallback, useEffect, useState } from 'react';
import { shop, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { gatewayLabel, useUsableMethods, PAYMENT_WINDOW_MIN } from '@/lib/payments';
import type { ManualAccount, Order } from '@/lib/types';
import { CheckIcon } from './icons';

type Manual = { paymentId: string; accounts: ManualAccount[]; note: string | null };

const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

function friendly(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === 'INSUFFICIENT_FUNDS' || /funds/i.test(err.message)) return 'رصيد محفظتك غير كافٍ.';
  if (/not awaiting payment/i.test(err.message)) return 'انتهت مهلة الدفع لهذا الطلب. أنشئ طلبًا جديدًا.';
  if (/already been reviewed/i.test(err.message)) return 'راجع المتجر هذا التحويل مسبقًا.';
  return err.message;
}

/**
 * Pays an order that is still PENDING_PAYMENT. A manual transfer shows the
 * owner's accounts and takes the transaction reference; the order then waits
 * for the owner to confirm the money arrived.
 */
export function PayOrder({ order, initial, onChange }: { order: Order; initial?: string; onChange: () => void }) {
  const methods = useUsableMethods(Number(order.total), order.currency);
  const [gateway, setGateway] = useState('');
  const [manual, setManual] = useState<Manual | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = [...(order.payments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const awaitingReview = latest?.gateway === 'MANUAL' && latest.status === 'AUTHORIZED';
  const rejected = latest?.gateway === 'MANUAL' && latest.status === 'FAILED' ? latest.failureReason : null;

  const startManual = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // reuses the open transfer attempt if there is one
      const [pay, info] = await Promise.all([shop.pay(order.id, 'MANUAL'), shop.manualAccounts()]);
      setManual({ paymentId: pay.paymentId, accounts: info.accounts, note: info.note });
    } catch (err) {
      setError(friendly(err, 'تعذّر تجهيز التحويل.'));
    } finally {
      setBusy(false);
    }
  }, [order.id]);

  useEffect(() => {
    if (!methods) return;
    const pick = initial && methods.includes(initial) ? initial : methods.includes('MANUAL') ? 'MANUAL' : (methods[0] ?? '');
    setGateway(pick);
    // a transfer already started (or chosen at checkout) opens straight on the transfer details
    if (pick === 'MANUAL' && !awaitingReview && (initial === 'MANUAL' || latest?.status === 'INITIATED')) startManual();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [methods]);

  async function payOther() {
    setBusy(true);
    setError(null);
    try {
      const pay = await shop.pay(order.id, gateway, window.location.href);
      if (pay.status === 'REQUIRES_ACTION' && pay.redirectUrl) {
        window.location.href = pay.redirectUrl;
        return;
      }
      onChange();
    } catch (err) {
      setError(friendly(err, 'تعذّر إتمام الدفع.'));
    } finally {
      setBusy(false);
    }
  }

  if (awaitingReview && !editing) {
    return (
      <div className="surface mt-6 rounded-2xl border border-warn/30 p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-warn/12 text-warn">
            <CheckIcon size={20} />
          </span>
          <div>
            <h2 className="font-bold">وصلنا رقم عمليتك، بانتظار تأكيد المتجر</h2>
            <p className="mt-1 text-sm text-muted">
              نتحقّق من وصول المبلغ ثم نسلّمك طلبك هنا. حدّث الصفحة لاحقًا لترى الكود.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onChange} className="btn-brand rounded-xl px-4 py-2 text-sm font-bold">
            تحديث
          </button>
          <button
            onClick={() => {
              setEditing(true);
              startManual();
            }}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted"
          >
            تصحيح رقم العملية
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface mt-6 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">ادفع لإتمام الطلب</h2>
      <p className="mt-1 text-sm text-muted">
        المبلغ: <b className="tnum text-[rgb(var(--text))]">{money(order.total, order.currency)}</b> · أكمل الدفع خلال {PAYMENT_WINDOW_MIN} دقيقة من إنشاء الطلب.
      </p>

      {rejected && (
        <p className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          لم يُقبل التحويل السابق: {rejected}. يمكنك المحاولة مجددًا.
        </p>
      )}

      {methods === null && <p className="mt-4 text-sm text-muted">جارٍ التحميل…</p>}
      {methods?.length === 0 && (
        <p className="mt-4 text-sm text-muted">لا توجد وسيلة دفع متاحة حاليًا. تواصل مع المتجر.</p>
      )}

      {manual ? (
        <TransferForm
          manual={manual}
          order={order}
          onBack={methods && methods.length > 1 ? () => setManual(null) : undefined}
          onDone={() => {
            setManual(null);
            setEditing(false);
            onChange();
          }}
        />
      ) : (
        methods &&
        methods.length > 0 && (
          <>
            <div className="mt-4 flex flex-col gap-2">
              {methods.map((m) => (
                <label
                  key={m}
                  className={
                    'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ' +
                    (gateway === m ? 'border-teal bg-teal/5' : 'border-[rgb(var(--line))]')
                  }
                >
                  <input type="radio" name="gateway" checked={gateway === m} onChange={() => setGateway(m)} className="accent-teal" />
                  <span className="text-[15px] font-semibold">{gatewayLabel(m)}</span>
                </label>
              ))}
            </div>
            <button
              onClick={gateway === 'MANUAL' ? startManual : payOther}
              disabled={busy || !gateway}
              className="btn-brand mt-4 w-full rounded-xl py-3 text-[15px] font-bold disabled:opacity-60"
            >
              {busy ? 'جارٍ…' : gateway === 'MANUAL' ? 'عرض حسابات التحويل' : 'ادفع الآن'}
            </button>
          </>
        )
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function TransferForm({
  manual,
  order,
  onBack,
  onDone,
}: {
  manual: Manual;
  order: Order;
  onBack?: () => void;
  onDone: () => void;
}) {
  const [accountId, setAccountId] = useState(manual.accounts[0]?.id ?? '');
  const [reference, setReference] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked: the number is selectable anyway
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reference.trim().length < 3) {
      setError('اكتب رقم العملية كما يظهر في رسالة التحويل.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await shop.submitTransfer(manual.paymentId, {
        accountId,
        reference: reference.trim(),
        payerName: payerName.trim() || undefined,
        payerPhone: payerPhone.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(friendly(err, 'تعذّر إرسال رقم العملية.'));
    } finally {
      setBusy(false);
    }
  }

  if (manual.accounts.length === 0) {
    return <p className="mt-4 text-sm text-muted">لم يضف المتجر حسابات التحويل بعد. تواصل مع المتجر.</p>;
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
      <div>
        <div className="text-sm font-bold">1. حوّل المبلغ إلى أحد هذه الحسابات</div>
        <div className="mt-2 flex flex-col gap-2">
          {manual.accounts.map((a) => (
            <label
              key={a.id}
              className={
                'flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 transition ' +
                (accountId === a.id ? 'border-teal bg-teal/5' : 'border-[rgb(var(--line))]')
              }
            >
              <input type="radio" name="account" checked={accountId === a.id} onChange={() => setAccountId(a.id)} className="mt-1 accent-teal" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{a.method}</div>
                <div className="text-sm text-muted">{a.accountName}</div>
                <div className="mt-1 flex items-center gap-2">
                  <span dir="ltr" className="select-all font-mono text-[15px] font-bold">
                    {a.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(a.id, a.accountNumber)}
                    className="rounded-lg border border-[rgb(var(--line))] px-2 py-0.5 text-xs font-bold text-muted"
                  >
                    {copied === a.id ? 'نُسخ ✓' : 'نسخ'}
                  </button>
                </div>
                {a.instructions && <p className="mt-1 text-xs text-muted">{a.instructions}</p>}
              </div>
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm">
          المبلغ المطلوب: <b className="tnum text-teal">{money(order.total, order.currency)}</b> · اكتب رقم الطلب{' '}
          <b dir="ltr">{order.orderNumber}</b> في ملاحظة التحويل إن أمكن.
        </p>
        {manual.note && <p className="mt-1 text-xs text-muted">{manual.note}</p>}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="text-sm font-bold">2. أرسل لنا رقم العملية</div>
        <input
          className={field}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={100}
          dir="ltr"
          placeholder="رقم العملية / Transaction ID"
          required
        />
        <div className="grid gap-2.5 sm:grid-cols-2">
          <input className={field} value={payerName} onChange={(e) => setPayerName(e.target.value)} maxLength={80} placeholder="اسم المحوِّل (اختياري)" />
          <input
            className={field}
            value={payerPhone}
            onChange={(e) => setPayerPhone(e.target.value)}
            maxLength={20}
            dir="ltr"
            inputMode="tel"
            placeholder="رقم هاتف المحوِّل (اختياري)"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-brand flex-1 rounded-xl py-3 text-[15px] font-bold disabled:opacity-60">
          {busy ? 'جارٍ الإرسال…' : 'أرسلت المبلغ'}
        </button>
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold text-muted">
            رجوع
          </button>
        )}
      </div>
    </form>
  );
}
