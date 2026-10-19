'use client';

import { useEffect, useState } from 'react';
import { auth, ApiError } from '@/lib/api';
import { refreshMe, useMe } from '@/lib/session';
import { tNow, useT } from '@/lib/i18n';
import { DEFAULT_COUNTRY, nationalNumberProblem, toE164 } from '@/lib/countries';
import PhoneField from './PhoneField';
import WhatsAppHelp from './WhatsAppHelp';
import { CheckIcon, CloseIcon, ShieldIcon } from './icons';

// runs in handlers only, so tNow is safe here
function friendly(err: unknown): string {
  if (!(err instanceof ApiError)) return tNow('تعذّر الاتصال بالخادم. حاول مرة أخرى.');
  if (/Invalid or expired code/i.test(err.message)) return tNow('الرمز غير صحيح أو انتهت صلاحيته.');
  if (/Too many attempts/i.test(err.message)) return tNow('محاولات كثيرة. اطلب رمزًا جديدًا.');
  if (/another account/i.test(err.message)) return tNow('هذا الرقم مسجّل في حساب آخر.');
  if (err.status === 429) return tNow('طلبت رموزًا كثيرة. انتظر بضع دقائق.');
  return err.message;
}

/**
 * Verifying the WhatsApp number: the customer asks for a code, the shop owner
 * sends it to them on WhatsApp, the customer types it here.
 */
export default function VerifyPanel({
  onVerified,
  onSkip,
  skipLabel = 'تخطَّ الآن',
}: {
  onVerified?: () => void;
  /** Shown as a "not now" button when given. */
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const t = useT();
  const { me } = useMe();
  const [stage, setStage] = useState<'ask' | 'code' | 'done'>('ask');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsNumber = !!me && !me.phone;

  async function ask() {
    let phone: string | undefined;
    if (needsNumber) {
      const problem = nationalNumberProblem(country, number);
      if (problem) return setError(problem);
      phone = toE164(country, number);
    }
    setBusy(true);
    setError(null);
    try {
      const res = await auth.requestPhoneCode(phone);
      if (res.status === 'VERIFIED') return finish();
      setSentTo(res.phone);
      setStage('code');
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError(tNow('الرمز 6 أرقام.'));
    setBusy(true);
    setError(null);
    try {
      await auth.verifyPhone(code);
      finish();
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    setStage('done');
    refreshMe();
    onVerified?.();
  }

  if (stage === 'done') {
    return (
      <div className="flex flex-col items-center gap-2 py-4 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ok/12 text-ok">
          <CheckIcon size={24} />
        </span>
        <p className="font-bold">{t('تم توثيق حسابك')}</p>
        <p className="text-sm text-muted">{t('يمكنك الآن الشراء.')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-warn/12 text-warn">
          <ShieldIcon size={20} />
        </span>
        <div>
          <p className="font-bold">{t('وثّق رقم واتساب')}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">
            {stage === 'ask'
              ? t('نرسل لك رمزًا من 6 أرقام على واتساب لنتأكد أن الرقم لك. يلزم ذلك مرة واحدة قبل الشراء.')
              : t('سيرسل لك المتجر الرمز على واتساب خلال دقائق. اكتبه هنا عند وصوله.')}
          </p>
        </div>
      </div>

      {stage === 'ask' ? (
        <>
          {needsNumber ? (
            <PhoneField country={country} onCountry={setCountry} value={number} onChange={setNumber} />
          ) : (
            me?.phone && (
              <p className="surface-2 rounded-xl px-3.5 py-2.5 text-sm">
                {t('الرقم:')}{' '}
                <span dir="ltr" className="font-bold">
                  {me.phone}
                </span>
              </p>
            )
          )}
          {error && (
            <p className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {error}
            </p>
          )}
          <button
            onClick={ask}
            disabled={busy}
            className="btn-brand rounded-xl py-3 text-[15px] font-bold disabled:opacity-60"
          >
            {busy ? t('جارٍ الطلب…') : t('أرسل لي رمز التحقق')}
          </button>
          {me?.phone && (
            <WhatsAppHelp
              name={me.fullName}
              phone={me.phone}
              need="verify"
              // the same tap asks for the code, so the owner finds it waiting in the dashboard
              onOpen={() => {
                auth
                  .requestPhoneCode()
                  .then((r) => {
                    if (r.status === 'VERIFIED') return finish();
                    setSentTo(r.phone);
                    setStage('code');
                  })
                  .catch(() => undefined);
              }}
            />
          )}
        </>
      ) : (
        <form onSubmit={verify} className="flex flex-col gap-3">
          {sentTo && (
            <p className="text-xs text-muted">
              {t('على الرقم')}{' '}
              <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
                {sentTo}
              </span>
            </p>
          )}
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            dir="ltr"
            placeholder="••••••"
            aria-label={t('رمز التحقق')}
            className="surface-2 hairline w-full rounded-xl border px-3.5 py-3 text-center text-2xl font-bold tracking-[0.5em] outline-none focus:border-teal"
          />
          {error && (
            <p className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="btn-brand rounded-xl py-3 text-[15px] font-bold disabled:opacity-60"
          >
            {busy ? t('جارٍ التحقق…') : t('تحقّق')}
          </button>
          <button
            type="button"
            onClick={ask}
            disabled={busy}
            className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
          >
            {t('لم يصلك الرمز؟ أعد الطلب')}
          </button>
          <WhatsAppHelp name={me?.fullName} phone={sentTo ?? me?.phone} need="verify" />
        </form>
      )}

      {onSkip && (
        <button onClick={onSkip} className="py-1 text-sm font-bold text-muted hover:text-[rgb(var(--text))]">
          {/* a label that is already translated comes back unchanged */}
          {t(skipLabel)}
        </button>
      )}
    </div>
  );
}

/** The panel in a bottom sheet (phones) / dialog (desktop). */
export function VerifySheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('توثيق الحساب')}
        onClick={(e) => e.stopPropagation()}
        className="surface w-full rounded-t-3xl p-5 shadow-float sm:max-w-md sm:rounded-3xl"
      >
        <div className="mb-2 flex justify-end">
          <button
            onClick={onClose}
            aria-label={t('إغلاق')}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-[rgb(var(--surface-2))]"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <VerifyPanel onVerified={() => setTimeout(onClose, 1600)} onSkip={onClose} />
      </div>
    </div>
  );
}
