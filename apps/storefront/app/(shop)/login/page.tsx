'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, ApiError, warmUp } from '@/lib/api';
import { accounts, authError } from '@/lib/auth2';
import { safeNext } from '@/lib/safe-next';
import { useT, tNow } from '@/lib/i18n';
import { refreshMe } from '@/lib/session';
import { DEFAULT_COUNTRY, nationalNumberProblem, toE164 } from '@/lib/countries';
import PhoneField from '@/components/PhoneField';
import WhatsAppHelp from '@/components/WhatsAppHelp';
import { browseAsGuest } from '@/lib/guest';
import { ShieldIcon } from '@/components/icons';
import ContactField, { FormError, PasswordInput, type ContactValue } from '@/components/auth/ContactField';
import PasskeyButton from '@/components/auth/PasskeyButton';

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
  const [step, setStep] = useState<'details' | 'code' | 'password'>('details');
  const [contact, setContact] = useState<ContactValue>({ value: '', problem: null });
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

  // an email account, or a WhatsApp number that added a password
  async function passwordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (contact.problem) return setError(contact.problem);
    setBusy(true);
    setError(null);
    try {
      await accounts.login(contact.value, password);
      done();
    } catch (err) {
      setError(authError(err));
      setBusy(false);
    }
  }

  const otherWays = (
    <div className="mt-6 flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-[rgb(var(--line))]" />
        {t('أو')}
        <span className="h-px flex-1 bg-[rgb(var(--line))]" />
      </div>
      <PasskeyButton onSignedIn={done} onError={setError} />
      <button
        type="button"
        onClick={() => {
          setStep('password');
          setError(null);
        }}
        className="surface hairline w-full rounded-xl border py-3.5 text-[15px] font-bold transition hover:border-teal"
      >
        {t('الدخول بالبريد أو الهاتف وكلمة المرور')}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1 text-sm">
        <Link href="/reset-password" className="font-bold text-teal hover:underline">
          {t('نسيت كلمة المرور؟')}
        </Link>
        <Link href="/recover" className="font-bold text-muted hover:text-[rgb(var(--text))]">
          {t('طلب مساعدة لاستعادة حسابي')}
        </Link>
      </div>
    </div>
  );

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
            {otherWays}
            <p className="mt-5 text-center text-sm text-muted">
              {t('تفضّل البريد الإلكتروني؟')}{' '}
              <Link href={next === '/' ? '/register' : `/register?next=${encodeURIComponent(next)}`} className="font-bold text-teal hover:underline">
                {t('أنشئ حسابًا بالبريد')}
              </Link>
            </p>
          </>
        ) : step === 'password' ? (
          <>
            <h1 className="text-2xl font-extrabold">{t('الدخول بكلمة المرور')}</h1>
            <p className="mt-1.5 text-sm text-muted">{t('برقم هاتفك أو بريدك الإلكتروني، وكلمة المرور التي اخترتها.')}</p>
            <form
              onSubmit={passwordLogin}
              className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6"
            >
              <ContactField onChange={setContact} autoFocus />
              <PasswordInput
                value={password}
                onChange={setPassword}
                label={t('كلمة المرور')}
                autoComplete="current-password"
              />
              <FormError message={error} />
              <button
                type="submit"
                disabled={busy}
                className="btn-brand rounded-xl py-3.5 text-[15px] font-bold disabled:opacity-60"
              >
                {busy ? t('جارٍ الدخول…') : t('دخول')}
              </button>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <Link href="/reset-password" className="font-bold text-teal hover:underline">
                  {t('نسيت كلمة المرور؟')}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setStep('details');
                    setError(null);
                  }}
                  className="font-bold text-muted hover:text-[rgb(var(--text))]"
                >
                  {t('الدخول برقم واتساب')}
                </button>
              </div>
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
