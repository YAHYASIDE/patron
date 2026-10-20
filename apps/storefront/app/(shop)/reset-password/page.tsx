'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { warmUp } from '@/lib/api';
import { accounts, authError, passwordRuleText, strongPassword } from '@/lib/auth2';
import { safeNext } from '@/lib/safe-next';
import { refreshMe } from '@/lib/session';
import { useT } from '@/lib/i18n';
import ContactField, { CodeInput, FormError, PasswordInput, type ContactValue } from '@/components/auth/ContactField';

/**
 * Forgot password: a code goes to the number (WhatsApp/SMS) or the email, and
 * only that code lets a new password be set. The first answer is the same
 * whether an account exists or not.
 */
function ResetInner() {
  const router = useRouter();
  const t = useT();
  const next = safeNext(useSearchParams().get('next'));
  const [step, setStep] = useState<'ask' | 'code'>('ask');
  const [contact, setContact] = useState<ContactValue>({ value: '', problem: null });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => warmUp(), []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (contact.problem) return setError(contact.problem);
    setBusy(true);
    setError(null);
    try {
      await accounts.forgotPassword(contact.value);
      setStep('code');
    } catch (err) {
      setError(authError(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError(t('الرمز 6 أرقام.'));
    if (!strongPassword(password)) return setError(passwordRuleText());
    setBusy(true);
    setError(null);
    try {
      await accounts.resetPassword(contact.value, code, password);
      // straight in with the new password
      await accounts.login(contact.value, password);
      refreshMe();
      router.replace(next);
    } catch (err) {
      setError(authError(err));
      setBusy(false);
    }
  }

  const byPhone = contact.value.startsWith('+');

  return (
    <div className="mx-auto max-w-page px-4 py-10">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-2xl font-extrabold">{t('استعادة كلمة المرور')}</h1>

        {step === 'ask' ? (
          <>
            <p className="mt-1.5 text-sm text-muted">{t('اكتب رقمك أو بريدك، وسنرسل رمزًا لتختار كلمة مرور جديدة.')}</p>
            <form onSubmit={ask} className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
              <ContactField onChange={setContact} autoFocus />
              <FormError message={error} />
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الإرسال…') : t('أرسل الرمز')}
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {byPhone
                ? t('إن كان لهذا الرقم حساب، فسيصله رمز من 6 أرقام على واتساب أو برسالة. قد يستغرق بضع دقائق.')
                : t('إن كان لهذا البريد حساب، فسيصله رمز من 6 أرقام صالح 15 دقيقة.')}{' '}
              <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
                {contact.value}
              </span>
            </p>
            <form onSubmit={reset} className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
              <CodeInput value={code} onChange={setCode} label={t('رمز الاستعادة')} />
              <PasswordInput
                value={password}
                onChange={setPassword}
                label={t('كلمة المرور الجديدة')}
                autoComplete="new-password"
                hint={t('كلمة المرور: 10 أحرف على الأقل، فيها حرف كبير وحرف صغير ورقم.')}
              />
              <FormError message={error} />
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الحفظ…') : t('حفظ كلمة المرور والدخول')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('ask');
                  setCode('');
                  setError(null);
                }}
                className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
              >
                {t('تغيير الرقم أو البريد')}
              </button>
            </form>
          </>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link href="/login" className="font-bold text-muted hover:text-[rgb(var(--text))]">
            {t('العودة لتسجيل الدخول')}
          </Link>
          <Link href="/recover" className="font-bold text-teal hover:underline">
            {t('لا أستطيع الوصول إلى رقمي أو بريدي')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t('جارٍ التحميل…')}</div>}>
      <ResetInner />
    </Suspense>
  );
}
