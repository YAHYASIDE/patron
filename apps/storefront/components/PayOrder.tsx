'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { shop, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import { gatewayLabel, useUsableMethods, PAYMENT_WINDOW_MIN } from '@/lib/payments';
import { REGIONS, REGION_LABEL, servesRegion, setRegion, useRegion } from '@/lib/regions';
import { compressImage } from '@/lib/image';
import { useMe } from '@/lib/session';
import { useT, tNow } from '@/lib/i18n';
import type { ManualAccount, Order } from '@/lib/types';
import { CheckIcon } from './icons';
import PayLogo from './PayLogo';

type Manual = { paymentId: string; accounts: ManualAccount[]; note: string | null };

const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

function friendly(err: unknown, fallback: string) {
  if (!(err instanceof ApiError)) return fallback;
  if (err.code === 'INSUFFICIENT_FUNDS' || /funds/i.test(err.message)) return tNow('رصيد محفظتك غير كافٍ.');
  if (/not awaiting payment/i.test(err.message)) return tNow('انتهت مهلة الدفع لهذا الطلب. أنشئ طلبًا جديدًا.');
  if (/already been reviewed/i.test(err.message)) return tNow('راجع المتجر هذا التحويل مسبقًا.');
  if (err.code === 'PROOF_REQUIRED') return tNow('أرفق صورة التحويل.');
  return err.message;
}

/**
 * Pays an order that is still PENDING_PAYMENT. A manual transfer shows the
 * owner's accounts and takes the transaction reference; the order then waits
 * for the owner to confirm the money arrived.
 */
export function PayOrder({ order, initial, onChange }: { order: Order; initial?: string; onChange: () => void }) {
  const t = useT();
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
      setError(friendly(err, tNow('تعذّر تجهيز التحويل.')));
    } finally {
      setBusy(false);
    }
  }, [order.id]);

  // back from the card page: ask the API to check with the card provider (never trust the URL)
  const [cardNote, setCardNote] = useState<string | null>(null);
  useEffect(() => {
    const back = new URLSearchParams(window.location.search).get('card');
    if (!back || latest?.gateway !== 'STRIPE') return;
    window.history.replaceState(null, '', window.location.pathname);
    if (back === 'cancelled') return setCardNote(tNow('لم يكتمل الدفع بالبطاقة. يمكنك المحاولة مجددًا.'));
    setCardNote(tNow('نتحقّق من الدفع بالبطاقة…'));
    shop
      .confirmPayment(latest.id)
      .then((r) => {
        if (r.status === 'CAPTURED') return onChange();
        setCardNote(
          r.status === 'FAILED'
            ? tNow('رُفض الدفع بالبطاقة. جرّب بطاقة أخرى أو التحويل.')
            : tNow('الدفع قيد المعالجة. حدّث الصفحة بعد قليل.'),
        );
      })
      .catch(() => setCardNote(tNow('تعذّر التحقّق من الدفع. حدّث الصفحة.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError(
        gateway === 'STRIPE' && err instanceof ApiError && err.status === 400 && !err.code
          ? tNow('تعذّر فتح صفحة الدفع بالبطاقة الآن. حاول بعد قليل أو ادفع بالتحويل.')
          : friendly(err, tNow('تعذّر إتمام الدفع.')),
      );
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
            <h2 className="font-bold">{t('وصلنا تحويلك، بانتظار تأكيد المتجر')}</h2>
            <p className="mt-1 text-sm text-muted">
              {t('نتحقّق من وصول المبلغ ثم نسلّمك طلبك هنا. حدّث الصفحة لاحقًا لترى الكود.')}
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button onClick={onChange} className="btn-brand rounded-xl px-4 py-2 text-sm font-bold">
            {t('تحديث')}
          </button>
          <button
            onClick={() => {
              setEditing(true);
              startManual();
            }}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted"
          >
            {t('تصحيح بيانات التحويل')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="surface mt-6 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">{t('ادفع لإتمام الطلب')}</h2>
      <p className="mt-1 text-sm text-muted">
        {t('المبلغ:')} <b className="tnum text-[rgb(var(--text))]">{money(order.total, order.currency)}</b> ·{' '}
        {t('أكمل الدفع خلال {n} دقيقة من إنشاء الطلب.', { n: PAYMENT_WINDOW_MIN })}
      </p>

      {cardNote && (
        <p className="mt-3 rounded-xl border border-teal/30 bg-teal/5 px-3.5 py-2.5 text-sm">{cardNote}</p>
      )}

      {rejected && (
        <p className="mt-3 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          {t('لم يُقبل التحويل السابق: {reason}. يمكنك المحاولة مجددًا.', { reason: rejected })}
        </p>
      )}

      {methods === null && <p className="mt-4 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {methods?.length === 0 && (
        <p className="mt-4 text-sm text-muted">{t('لا توجد وسيلة دفع متاحة حاليًا. تواصل مع المتجر.')}</p>
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
                  <span className="flex-1 text-[15px] font-semibold">{gatewayLabel(m, t)}</span>
                  {m === 'STRIPE' && (
                    <span className="flex gap-1">
                      <PayLogo logo="visa" name="Visa" size={28} />
                      <PayLogo logo="mastercard" name="Mastercard" size={28} />
                    </span>
                  )}
                </label>
              ))}
            </div>
            <button
              onClick={gateway === 'MANUAL' ? startManual : payOther}
              disabled={busy || !gateway}
              className="btn-brand mt-4 w-full rounded-xl py-3 text-[15px] font-bold disabled:opacity-60"
            >
              {busy
                ? t('جارٍ…')
                : gateway === 'MANUAL'
                  ? t('عرض وسائل التحويل')
                  : gateway === 'STRIPE'
                    ? t('ادفع بالبطاقة')
                    : t('ادفع الآن')}
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

const PAID_FROM: Record<ManualAccount['kind'], { label: string; hint: string; ltr: boolean }> = {
  mobile: { label: 'الرقم الذي حوّلت منه', hint: 'رقم هاتفك في التطبيق الذي دفعت به', ltr: true },
  bank: { label: 'الحساب أو الرقم الذي حوّلت منه', hint: 'رقم حسابك أو هاتفك في تطبيق البنك', ltr: true },
  crypto: { label: 'معرّف Binance أو عنوان محفظتك', hint: 'الحساب الذي أرسلت منه', ltr: true },
};

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
  const t = useT();
  const { me } = useMe();
  const region = useRegion(me?.phone);
  const accounts = manual.accounts.filter((a) => servesRegion(a.countries, region));
  const [accountId, setAccountId] = useState('');
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const [payerPhone, setPayerPhone] = useState('');
  // most pay from their own number: start with it once the account has loaded
  const ownNumber = me?.phone?.replace(/^\+222/, '') ?? '';
  useEffect(() => {
    if (ownNumber && account?.kind !== 'crypto') setPayerPhone((v) => v || ownNumber);
  }, [ownNumber, account?.kind]);
  const [reference, setReference] = useState('');
  const [image, setImage] = useState<{ blob: Blob } | null>(null);
  const [uploaded, setUploaded] = useState<Blob | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function copy(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard blocked: the number is selectable anyway
    }
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError(tNow('اختر صورة (لقطة شاشة للتحويل).'));
    setError(null);
    const blob = await compressImage(file);
    setImage({ blob });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    if (payerPhone.trim().length < 4) return setError(tNow('اكتب {label}.', { label: tNow(PAID_FROM[account.kind].label) }));
    if (!image) return setError(tNow('أرفق صورة التحويل (لقطة شاشة من التطبيق).'));
    setBusy(true);
    setError(null);
    try {
      // the same picture is not sent twice if the report itself failed
      if (uploaded !== image.blob) {
        await shop.uploadProof(manual.paymentId, image.blob);
        setUploaded(image.blob);
      }
      await shop.submitTransfer(manual.paymentId, {
        accountId: account.id,
        payerPhone: payerPhone.trim(),
        reference: reference.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && /JPEG, PNG or WebP|too large/i.test(err.message)
          ? tNow('تعذّر قبول الصورة. أرسل لقطة شاشة بصيغة JPG أو PNG.')
          : friendly(err, tNow('تعذّر إرسال التحويل.')),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-5">
      <div className="surface-2 flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm">
        <span>
          {t('تدفع من:')} <b>{t(REGION_LABEL[region])}</b>
        </span>
        <select
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            setAccountId('');
          }}
          aria-label={t('بلد الدفع')}
          className="rounded-lg bg-transparent text-sm font-bold text-teal outline-none"
        >
          {REGIONS.map((r) => (
            <option key={r.id} value={r.id}>
              {t(REGION_LABEL[r.id])}
            </option>
          ))}
        </select>
      </div>

      {accounts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[rgb(var(--line))] px-4 py-5 text-center text-sm text-muted">
          {t('لا توجد وسيلة دفع لهذا البلد بعد. راسلنا على واتساب لنساعدك في الدفع.')}
        </p>
      ) : (
        <>
          <div>
            <div className="text-sm font-bold">1. {t('اختر الوسيلة وحوّل المبلغ')}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {accounts.map((a) => (
                <button
                  type="button"
                  key={a.id}
                  onClick={() => setAccountId(a.id)}
                  aria-pressed={account?.id === a.id}
                  className={
                    'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start transition ' +
                    (account?.id === a.id ? 'border-teal bg-teal/5 ring-1 ring-teal' : 'border-[rgb(var(--line))]')
                  }
                >
                  <PayLogo logo={a.logo} name={a.method} size={34} />
                  <span className="min-w-0 text-[13px] font-bold leading-tight">{a.method}</span>
                </button>
              ))}
            </div>

            {account && (
              <div className="surface-2 mt-3 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <PayLogo logo={account.logo} name={account.method} size={44} />
                  <div className="min-w-0">
                    <div className="font-bold">{account.method}</div>
                    {account.accountName && <div className="text-sm text-muted">{account.accountName}</div>}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-[rgb(var(--surface))] px-3 py-2.5">
                  <span dir="ltr" className="select-all break-all font-mono text-[17px] font-bold">
                    {account.accountNumber}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(account.id, account.accountNumber)}
                    className="flex-none rounded-lg border border-[rgb(var(--line))] px-2.5 py-1 text-xs font-bold text-muted"
                  >
                    {copied === account.id ? t('نُسخ ✓') : t('نسخ')}
                  </button>
                </div>
                {account.instructions && <p className="mt-2 text-xs text-muted">{account.instructions}</p>}
                <p className="mt-2.5 text-sm">
                  {t('المبلغ:')} <b className="tnum text-teal">{money(order.total, order.currency)}</b> ·{' '}
                  {t('اكتب رقم الطلب')} <b dir="ltr">{order.orderNumber}</b> {t('في ملاحظة التحويل إن أمكن.')}
                </p>
              </div>
            )}
            {manual.note && <p className="mt-2 text-xs text-muted">{manual.note}</p>}
          </div>

          {account && (
            <div className="flex flex-col gap-2.5">
              <div className="text-sm font-bold">2. {t(PAID_FROM[account.kind].label)}</div>
              <input
                className={field}
                value={payerPhone}
                onChange={(e) => setPayerPhone(e.target.value)}
                maxLength={120}
                dir="ltr"
                inputMode={account.kind === 'crypto' ? 'text' : 'tel'}
                placeholder={t(PAID_FROM[account.kind].hint)}
              />
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            <div className="text-sm font-bold">3. {t('صورة التحويل')}</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="hidden" />
            {image ? (
              <div className="flex items-center gap-3">
                <ReceiptPreview blob={image.blob} label={t('صورة التحويل')} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted"
                >
                  {t('تغيير الصورة')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center gap-1 rounded-xl border-2 border-dashed border-[rgb(var(--line))] px-4 py-5 text-sm transition hover:border-teal"
              >
                <span className="font-bold text-teal">+ {t('أرفق لقطة شاشة للتحويل')}</span>
                <span className="text-xs text-muted">{t('تظهر فيها العملية والمبلغ')}</span>
              </button>
            )}
            <input
              className={field}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              dir="ltr"
              placeholder={t('رقم العملية (اختياري) / Transaction ID')}
            />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {accounts.length > 0 && (
          <button type="submit" disabled={busy} className="btn-brand flex-1 rounded-xl py-3 text-[15px] font-bold disabled:opacity-60">
            {busy ? t('جارٍ الإرسال…') : t('أرسلت المبلغ')}
          </button>
        )}
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-xl border border-[rgb(var(--line))] px-4 py-3 text-sm font-bold text-muted">
            {t('رجوع')}
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * The chosen screenshot, drawn on a canvas: the picture never goes through a
 * URL, so nothing the customer picked is ever read back as markup.
 */
function ReceiptPreview({ blob, label }: { blob: Blob; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    createImageBitmap(blob)
      .then((bitmap) => {
        const el = canvas.current;
        const ctx = el?.getContext('2d');
        if (!alive || !el || !ctx) return bitmap.close();
        // cover an 80×96 box, at twice the pixels for sharp phone screens
        el.width = 160;
        el.height = 192;
        const scale = Math.max(el.width / bitmap.width, el.height / bitmap.height);
        const w = bitmap.width * scale;
        const h = bitmap.height * scale;
        ctx.drawImage(bitmap, (el.width - w) / 2, (el.height - h) / 2, w, h);
        bitmap.close();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [blob]);
  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      className="h-24 w-20 rounded-xl border border-[rgb(var(--line))] bg-[rgb(var(--surface-2))]"
    />
  );
}
