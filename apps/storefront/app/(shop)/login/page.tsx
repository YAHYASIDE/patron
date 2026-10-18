'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, ApiError, warmUp } from '@/lib/api';
import { refreshMe } from '@/lib/session';
import { DEFAULT_COUNTRY, nationalNumberProblem, toE164 } from '@/lib/countries';
import PhoneField from '@/components/PhoneField';
import { ShieldIcon } from '@/components/icons';

// Same rule as the API: Arabic or Latin (French) letters, spaces and name punctuation.
const NAME = /^[\p{Script=Arabic}\p{Script=Latin}][\p{Script=Arabic}\p{Script=Latin}\p{M}\s'’.-]{1,79}$/u;

const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-3 text-[16px] outline-none transition focus:border-teal';

function friendly(err: unknown): string {
  if (!(err instanceof ApiError)) return 'تعذّر الاتصال بالخادم. حاول مرة أخرى.';
  if (err.code === 'NAME_REQUIRED') return 'اكتب اسمك الكامل.';
  if (/Full name/i.test(err.message)) return 'اكتب الاسم بحروف عربية أو فرنسية.';
  if (/E\.164|phone/i.test(err.message)) return 'تحقّق من رقم واتساب.';
  if (/Invalid or expired code/i.test(err.message)) return 'الرمز غير صحيح أو انتهت صلاحيته.';
  if (/Too many/i.test(err.message)) return 'محاولات كثيرة. انتظر قليلًا ثم حاول مجددًا.';
  if (/blocked|inactive/i.test(err.message)) return 'هذا الحساب موقوف. تواصل مع المتجر.';
  if (err.status === 429) return 'محاولات كثيرة. انتظر دقيقة ثم حاول.';
  return err.message;
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/';
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

  async function start(e: React.FormEvent) {
    e.preventDefault();
    const problem = nationalNumberProblem(country, number);
    if (problem) return setError(problem);
    if (!NAME.test(name.trim())) return setError('اكتب اسمك الكامل بحروف عربية أو فرنسية.');
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
        err instanceof ApiError && err.status === 401 ? 'البريد أو كلمة المرور غير صحيحة.' : friendly(err),
      );
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError('الرمز 6 أرقام.');
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
            <h1 className="text-2xl font-extrabold">أهلًا بك في باترون</h1>
            <p className="mt-1.5 text-sm text-muted">ادخل برقم واتساب واسمك، بلا كلمة مرور.</p>

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
                <span className="text-sm font-semibold">الاسم الكامل</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  placeholder="مثال: سيدي أحمد / Sidi Ahmed"
                  className={field}
                />
                <span className="text-xs text-muted">بالعربية أو بالفرنسية، كما في هويتك.</span>
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
                {busy ? 'جارٍ الدخول…' : 'دخول'}
              </button>
            </form>

            <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
              <ShieldIcon size={15} className="mt-0.5 flex-none text-teal" />
              نوثّق رقمك برمز يصلك على واتساب قبل أول عملية شراء.
            </p>
            <button
              onClick={() => {
                setStep('email');
                setError(null);
              }}
              className="mt-6 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
            >
              لديك حساب بالبريد الإلكتروني؟ ادخل من هنا
            </button>
          </>
        ) : step === 'email' ? (
          <>
            <h1 className="text-2xl font-extrabold">الدخول بالبريد الإلكتروني</h1>
            <form
              onSubmit={emailLogin}
              className="surface mt-6 flex flex-col gap-4 rounded-2xl p-5 shadow-card sm:p-6"
            >
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">البريد الإلكتروني</span>
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
                <span className="text-sm font-semibold">كلمة المرور</span>
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
                {busy ? 'جارٍ الدخول…' : 'دخول'}
              </button>
              <button
                type="button"
                onClick={() => setStep('details')}
                className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
              >
                الدخول برقم واتساب
              </button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-extrabold">أدخل رمز الدخول</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              هذا الرقم موثّق مسبقًا. سيرسل لك المتجر رمزًا من 6 أرقام على واتساب{' '}
              <span dir="ltr" className="font-bold text-[rgb(var(--text))]">
                {phone}
              </span>
              . قد يستغرق ذلك بضع دقائق.
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
                aria-label="رمز الدخول"
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
                {busy ? 'جارٍ التحقق…' : 'دخول'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep('details');
                  setCode('');
                  setError(null);
                }}
                className="text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
              >
                تغيير الرقم
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">جارٍ التحميل…</div>}>
      <LoginInner />
    </Suspense>
  );
}
