'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError, isAuthed } from '@/lib/api';
import { accounts, authError, type MeSecurity } from '@/lib/auth2';
import { safeNext } from '@/lib/safe-next';
import { refreshMe } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { CodeInput, FormError } from '@/components/auth/ContactField';
import { CheckIcon } from '@/components/icons';

/** Confirm the account's email with the 6-digit code it received (valid 15 minutes). */
function VerifyEmailInner() {
  const router = useRouter();
  const t = useT();
  const next = safeNext(useSearchParams().get('next'));
  const [me, setMe] = useState<MeSecurity | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace(`/login?next=${encodeURIComponent('/verify-email')}`);
      return;
    }
    accounts.me().then(setMe).catch((e) => setError(authError(e)));
  }, [router]);

  // the resend button counts down instead of failing
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError(t('الرمز 6 أرقام.'));
    setBusy(true);
    setError(null);
    try {
      await accounts.verifyEmail(code);
      refreshMe();
      setDone(true);
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      const res = await accounts.resendEmailCode();
      if (res.status === 'VERIFIED') return setDone(true);
      setNotice(t('أرسلنا رمزًا جديدًا إلى بريدك.'));
      setCooldown(60);
    } catch (err) {
      const retry = err instanceof ApiError ? Number(err.body?.retryAfter) : 0;
      if (retry > 0) setCooldown(retry);
      setError(authError(err));
    }
  }

  const verified = done || !!me?.emailVerifiedAt;

  return (
    <div className="mx-auto max-w-page px-4 py-10">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-2xl font-extrabold">{t('تأكيد البريد الإلكتروني')}</h1>

        {verified ? (
          <div className="surface mt-6 flex flex-col items-center gap-3 rounded-2xl p-6 text-center shadow-card">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-ok/12 text-ok">
              <CheckIcon size={24} />
            </span>
            <p className="font-bold">{t('تم تأكيد بريدك الإلكتروني.')}</p>
            <button onClick={() => router.replace(next)} className="btn-brand w-full rounded-xl py-3 text-sm font-bold">
              {t('متابعة')}
            </button>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {t('أرسلنا رمزًا من 6 أرقام إلى')}{' '}
              <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
                {me?.email ?? '…'}
              </span>
              {t('. الرمز صالح 15 دقيقة.')}
            </p>
            <form onSubmit={confirm} className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
              <CodeInput value={code} onChange={setCode} label={t('رمز التأكيد')} />
              <FormError message={error} />
              {notice && <p className="text-sm text-ok">{notice}</p>}
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ التحقق…') : t('تأكيد')}
              </button>
              <button
                type="button"
                onClick={resend}
                disabled={cooldown > 0}
                className="text-sm font-bold text-teal hover:underline disabled:text-muted disabled:no-underline"
              >
                {cooldown > 0 ? t('إعادة الإرسال بعد {s} ثانية', { s: cooldown }) : t('لم يصلك الرمز؟ أعد الإرسال')}
              </button>
            </form>
            <p className="mt-4 text-center text-sm">
              <Link href={next} className="font-bold text-muted hover:text-[rgb(var(--text))]">
                {t('لاحقًا')}
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t('جارٍ التحميل…')}</div>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
