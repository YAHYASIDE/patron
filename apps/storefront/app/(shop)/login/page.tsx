'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, ApiError, warmUp } from '@/lib/api';
import { safeNext } from '@/lib/safe-next';
import { useT, tNow } from '@/lib/i18n';
import { refreshMe } from '@/lib/session';
import { DEFAULT_COUNTRY, nationalNumberProblem, toE164 } from '@/lib/countries';
import PhoneField from '@/components/PhoneField';
import WhatsAppHelp from '@/components/WhatsAppHelp';
import { browseAsGuest } from '@/lib/guest';
import { ShieldIcon } from '@/components/icons';

// Same rule as the API: Arabic or Latin (French) letters, spaces and name punctuation.
const NAME = /^[\p{Script=Arabic}\p{Script=Latin}][\p{Script=Arabic}\p{Script=Latin}\p{M}\s'’.-]{1,79}$/u;

const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-3 text-[16px] outline-none transition focus:border-teal';

function friendly(err: unknown): string {
  if (!(err instanceof ApiError)) return tNow('تعذّر الاتصال بالخادم. حاول مرة أخرى.');
  if (err.code === 'NAME_REQUIRED') return tNow('اكتب اسمك الكامل.');
  if (/Full name/i.test(err.message)) return tNow('اكتب الاسم بحروف عربية أو فرنسية.');
  if (/E\.164|phone/i.test(err.message)) return tNow('تحقّق من رقم واتساب.');
  if (/Invalid or expired code/i.test(err.message)) return tNow('الرمز غير صحيح أو انتهت صلاحيته.');
  if (/Too many/i.test(err.message)) return tNow('محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.');
  if (/blocked|inactive/i.test(err.message)) return tNow('هذا الحساب موقوف. تواصل مع المتجر.');
  if (err.status === 429) return tNow('محاولات كثيرة. انتظر دقيقة ثم حاول.');
  return err.message;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useT();
  const next = safeNext(params.get('next'));
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<'details' | 'code' | 'email'>('details');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // the submit is a POST (never auto-retried): wake the API while the form is filled
  useEffect(() => warmUp(), []);

  const phone = toE164(country, number);

  function done() {
    refreshMe();
    router.replace(next);
  }

  // browse first; signing in is asked again only to buy
  function skip() {
    browseAsGuest();
    router.replace(/^\/(checkout|orders|account)/.test(next) ? '/' : next);
  }

  const skipLink = (
    <button type="button" onClick={skip} className="py-1 text-sm font-bold text-teal hover:underline">
      {t('تخطَّ الآن وتصفّح المتجر')}
    </button>
  );

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const problem = nationalNumberProblem(country, number);
    if (problem) return setError(problem);
    if (!NAME.test(name.trim())) return setError(t('اكتب اسمك الكامل بحروف عربية أو فرنسية.'));
    setBusy(true);
    setError(null);
    try {
      const status = await auth.phoneStart({ phone, fullName: name.trim() });
      if (status === 'SIGNED_IN') return done();
      setStep('code');
    } catch (err) {
      setError(friendly(err));
    } finally {
      setBusy(false);
    }
  }

  // accounts created before WhatsApp sign-in still have an email and a password
  async function emailLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      done();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401 ? t('البريد أو كلمة المرور غير صحيحة.') : friendly(err),
      );
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError(t('الرمز 6 أرقام.'));
    setBusy(true);
    setError(null);
    try {
      await auth.phoneLogin(phone, code);
      done();
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-10">
      <div className="mx-auto max-w-[440px]">
        {step === 'details' ? (
          <>
            <h1 className="text-2xl font-extrabold">{t('أهلًا بك في patron')}</h1>
            <p className="mt-1.5 text-sm text-muted">{t('ادخل برقم واتساب واسمك، بلا كلمة مرور.')}</p>

            <form
              onSubmit={start}
              className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6"
            >
              <PhoneField
                country={country}
                onCountry={setCountry}
                value={number}
                onChange={setNumber}
                autoFocus
              />

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('الاسم الكامل')}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  placeholder={t('مثال: سيدي أحمد / Sidi Ahmed')}
                  className={field}
                />
                <span className="text-xs text-muted">{t('بالعربية أو بالفرنسية، كما في هويتك.')}</span>
              </label>

              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الدخول…') : t('دخول')}
              </button>
              {skipLink}
            </form>

            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldIcon size={15} className="mt-0.5 flex-none text-teal" />
              {t('نوثّق رقمك برمز يصلك على واتساب قبل أول عملية شراء.')}
            </p>
            <button
              onClick={() => {
                setStep('email');
                setError(null);
              }}
              className="mt-6 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
            >
              {t('لديك حساب بالبريد الإلكتروني؟ ادخل من هنا')}
            </button>
          </>
        ) : step === 'email' ? (
          <>
            <h1 className="text-2xl font-extrabold">{t('الدخول بالبريد الإلكتروني')}</h1>
            <form
              onSubmit={emailLogin}
              className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6"
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('البريد الإلكتروني')}</span>
                <input
                  type="email"
                  dir="ltr"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={field}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">{t('كلمة المرور')}</span>
                <input
                  type="password"
                  dir="ltr"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={field}
                />
              </label>
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الدخول…') : t('دخول')}
              </button>
              <button
                type="button"
                onClick={() => setStep('details')}
                className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
              >
                {t('الدخول برقم واتساب')}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold">{t('أدخل رمز الدخول')}</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {t('هذا الرقم مسجّل لدينا. لحماية حسابك، سيرسل لك المتجر رمزًا من 6 أرقام على واتساب')}{' '}
              <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
                {phone}
              </span>
              {t('. قد يستغرق ذلك بضع دقائق.')}
            </p>

            <form
              onSubmit={confirm}
              className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6"
            >
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                dir="ltr"
                placeholder="••••••"
                aria-label={t('رمز الدخول')}
                className={field + ' text-center text-2xl font-bold tracking-[0.5em]'}
              />
              {error && (
                <p
                  role="alert"
                  className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ التحقق…') : t('دخول')}
              </button>
              <WhatsAppHelp name={name.trim()} phone={phone} need="login" />
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep('details');
                    setCode('');
                    setError(null);
                  }}
                  className="py-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
                >
                  {t('تغيير الرقم')}
                </button>
                <button
                  type="button"
                  onClick={skip}
                  className="py-2 text-sm font-bold text-teal hover:underline"
                >
                  {t('تخطَّ الآن')}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">{t('جارٍ التحميل…')}</div>}>
      <LoginInner />
    </Suspense>
  );
}
