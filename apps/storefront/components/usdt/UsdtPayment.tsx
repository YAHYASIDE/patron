'use client';

import { useEffect, useRef, useState } from 'react';
import { shop } from '@/lib/api';
import { money } from '@/lib/format';
import { compressImage } from '@/lib/image';
import { REGIONS, REGION_LABEL, servesRegion, setRegion, useRegion } from '@/lib/regions';
import { useMe } from '@/lib/session';
import { useT, tNow } from '@/lib/i18n';
import { usdt, usdtError, type UsdtOrder } from '@/lib/usdt';
import type { ManualAccount } from '@/lib/types';
import Countdown from '../Countdown';
import PayLogo from '../PayLogo';
import { CheckIcon } from '../icons';
import { CopyText, field } from './shared';

/**
 * Paying a USDT order with the owner's usual transfer accounts: pick one, send
 * the exact total, give the number paid from and a screenshot. Staff then
 * check their account; nothing is sent before that.
 */
export default function UsdtPayment({ order, onChange }: { order: UsdtOrder; onChange: () => void }) {
  const t = useT();
  const { me } = useMe();
  const region = useRegion(me);
  const [all, setAll] = useState<{ accounts: ManualAccount[]; note: string | null } | null>(null);
  const [editing, setEditing] = useState(order.status === 'AWAITING_PAYMENT');
  const [accountId, setAccountId] = useState('');
  const [payerPhone, setPayerPhone] = useState(order.payerPhone ?? '');
  const [reference, setReference] = useState(order.paymentRef ?? '');
  const [image, setImage] = useState<Blob | null>(null);
  const [uploaded, setUploaded] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    shop
      .manualAccounts()
      .then(setAll)
      .catch(() => setAll({ accounts: [], note: null }));
  }, []);
  const ownNumber = me?.phone?.replace(/^\+222/, '') ?? '';
  useEffect(() => {
    if (ownNumber) setPayerPhone((v) => v || ownNumber);
  }, [ownNumber]);

  // the same accounts as checkout, without crypto ones (USDT is paid for in money)
  const accounts = (all?.accounts ?? []).filter((a) => a.kind !== 'crypto' && servesRegion(a.countries, region));
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError(tNow('اختر صورة (لقطة شاشة للتحويل).'));
    setError(null);
    setImage(await compressImage(file));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    if (payerPhone.trim().length < 4) return setError(tNow('اكتب الرقم الذي حوّلت منه.'));
    if (!image && !order.hasProof) return setError(tNow('أرفق صورة التحويل (لقطة شاشة من التطبيق).'));
    setBusy(true);
    setError(null);
    try {
      if (image && uploaded !== image) {
        await usdt.uploadProof(order.id, image);
        setUploaded(image);
      }
      await usdt.pay(order.id, { method: account.id, payerPhone: payerPhone.trim(), reference: reference.trim() || undefined });
      setEditing(false);
      onChange();
    } catch (err) {
      setError(usdtError(err, tNow('تعذّر إرسال التحويل.')));
      if ((err as { code?: string }).code === 'USDT_ORDER_EXPIRED') onChange();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm(tNow('إلغاء هذا الطلب؟'))) return;
    setBusy(true);
    try {
      await usdt.cancel(order.id);
      onChange();
    } catch (err) {
      setError(usdtError(err, tNow('تعذّر إلغاء الطلب.')));
    } finally {
      setBusy(false);
    }
  }

  if (order.status === 'UNDER_REVIEW' && !editing) {
    return (
      <div className="surface mt-4 rounded-2xl border border-teal/30 p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal/12 text-teal">
            <CheckIcon size={20} />
          </span>
          <div>
            <h2 className="font-bold">{t('وصلنا إبلاغك بالتحويل')}</h2>
            <p className="mt-1 text-sm text-muted">{t('نتحقّق من وصول المبلغ ثم نرسل USDT يدويًا، وتظهر هنا رقم العملية.')}</p>
          </div>
        </div>
        <button
          onClick={() => setEditing(true)}
          className="mt-4 rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted"
        >
          {t('تصحيح بيانات التحويل')}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="surface mt-4 flex flex-col gap-5 rounded-2xl p-4 shadow-card sm:p-5">
      <div>
        <h2 className="text-base font-bold">{t('ادفع لإتمام الطلب')}</h2>
        <p className="mt-1 text-sm text-muted">
          {t('حوّل المبلغ بالضبط:')} <b className="tnum text-[rgb(var(--text))]">{money(order.total, order.currency)}</b>
        </p>
        {order.status === 'AWAITING_PAYMENT' && order.expiresAt && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-warn">
            {t('الوقت المتبقّي للدفع:')} <Countdown endsAt={order.expiresAt} onEnd={onChange} />
          </p>
        )}
      </div>

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

      {all === null ? (
        <p className="text-sm text-muted">{t('جارٍ التحميل…')}</p>
      ) : accounts.length === 0 ? (
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
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-start transition ${account?.id === a.id ? 'border-teal bg-teal/5 ring-1 ring-teal' : 'border-[rgb(var(--line))]'}`}
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
                <div className="mt-3">
                  <CopyText text={account.accountNumber} />
                </div>
                {account.instructions && <p className="mt-2 text-xs text-muted">{account.instructions}</p>}
                <p className="mt-2.5 text-sm">
                  {t('اكتب رقم الطلب')} <b dir="ltr">{order.number}</b> {t('في ملاحظة التحويل إن أمكن.')}
                </p>
              </div>
            )}
            {all.note && <p className="mt-2 text-xs text-muted">{all.note}</p>}
          </div>

          <div className="flex flex-col gap-2.5">
            <label htmlFor="usdt-payer" className="text-sm font-bold">
              2. {t('الرقم الذي حوّلت منه')}
            </label>
            <input
              id="usdt-payer"
              className={field}
              value={payerPhone}
              onChange={(e) => setPayerPhone(e.target.value)}
              maxLength={120}
              dir="ltr"
              inputMode="tel"
              placeholder={t('رقم هاتفك في التطبيق الذي دفعت به')}
            />
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="text-sm font-bold">3. {t('صورة التحويل')}</div>
            <input ref={fileRef} type="file" accept="image/*" onChange={pick} className="hidden" />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={`flex flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-sm transition hover:border-teal ${image || order.hasProof ? 'border-ok/50' : 'border-[rgb(var(--line))]'}`}
            >
              {image || order.hasProof ? (
                <>
                  <span className="font-bold text-ok">✓ {t('الصورة جاهزة')}</span>
                  <span className="text-xs text-muted">{t('اضغط لتغيير الصورة')}</span>
                </>
              ) : (
                <>
                  <span className="font-bold text-teal">+ {t('أرفق لقطة شاشة للتحويل')}</span>
                  <span className="text-xs text-muted">{t('تظهر فيها العملية والمبلغ')}</span>
                </>
              )}
            </button>
            <input
              className={field}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              dir="ltr"
              placeholder={t('رقم العملية (اختياري)')}
            />
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {accounts.length > 0 && (
          <button type="submit" disabled={busy} className="btn-brand flex-1 rounded-xl py-3 text-[15px] font-bold disabled:opacity-60">
            {busy ? t('جارٍ الإرسال…') : t('أرسلت المبلغ')}
          </button>
        )}
        {order.status === 'AWAITING_PAYMENT' ? (
          <button type="button" onClick={cancel} disabled={busy} className="rounded-xl border border-[rgb(var(--line))] px-4 py-3 text-sm font-bold text-muted">
            {t('إلغاء الطلب')}
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(false)} className="rounded-xl border border-[rgb(var(--line))] px-4 py-3 text-sm font-bold text-muted">
            {t('رجوع')}
          </button>
        )}
      </div>
    </form>
  );
}
