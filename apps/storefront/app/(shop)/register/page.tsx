'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { warmUp } from '@/lib/api';
import { accounts, authError, passwordRuleText, strongPassword } from '@/lib/auth2';
import { safeNext } from '@/lib/safe-next';
import { refreshMe } from '@/lib/session';
import { useLang, useT } from '@/lib/i18n';
import { authField, FormError, PasswordInput } from '@/components/auth/ContactField';

/**
 * Sign-up. The WhatsApp number stays the default (one step, no password, on
 * /login); customers who prefer it can open an account with an email and a
 * password, then confirm the email with a code.
 */
function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const lang = useLang();
  const next = safeNext(params.get('next'));
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => warmUp(), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (fullName.trim().length < 2) return setError(t('اكتب اسمك الكامل.'));
    if (!strongPassword(password)) return setError(passwordRuleText());
    setBusy(true);
    setError(null);
    try {
      await accounts.register({ email: email.trim().toLowerCase(), password, fullName: fullName.trim(), locale: lang });
      refreshMe();
      router.replace(`/verify-email?next=${encodeURIComponent(next)}`);
    } catch (err) {
      setError(authError(err));
      setBusy(false);
    }
  }

  const whatsapp = next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`;

  return (
    <div className="mx-auto max-w-page px-4 py-10">
      <div className="mx-auto max-w-[440px]">
        <h1 className="text-2xl font-extrabold">{t('إنشاء حساب')}</h1>
        <p className="mt-1.5 text-sm text-muted">{t('الأسهل: رقم واتساب واسمك، بلا كلمة مرور.')}</p>

        <Link
          href={whatsapp}
          className="btn-brand mt-6 flex w-full items-center justify-center rounded-xl py-3.5 text-[15px] font-bold"
        >
          {t('التسجيل برقم واتساب')}
        </Link>

        <div className="my-6 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-[rgb(var(--line))]" />
          {t('أو بالبريد الإلكتروني وكلمة مرور')}
          <span className="h-px flex-1 bg-[rgb(var(--line))]" />
        </div>

        <form onSubmit={submit} className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{t('الاسم الكامل')}</span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              className={authField}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">{t('البريد الإلكتروني')}</span>
            <input
              type="email"
              dir="ltr"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={authField}
            />
          </label>
          <PasswordInput
            value={password}
            onChange={setPassword}
            label={t('كلمة المرور')}
            autoComplete="new-password"
            hint={t('كلمة المرور: 10 أحرف على الأقل، فيها حرف كبير وحرف صغير ورقم.')}
          />
          <FormError message={error} />
          <button
            type="submit"
            disabled={busy}
            className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
          >
            {busy ? t('جارٍ إنشاء الحساب…') : t('إنشاء الحساب')}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          {t('لديك حساب؟')}{' '}
          <Link href={whatsapp} className="font-bold text-teal hover:underline">
            {t('سجّل الدخول')}
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t('جارٍ التحميل…')}</div>}>
      <RegisterInner />
    </Suspense>
  );
}
