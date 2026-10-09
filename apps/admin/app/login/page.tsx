'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, ApiError } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'البريد أو كلمة المرور غير صحيحة.'
            : err.message
          : 'تعذّر الاتصال بالخادم. تأكد من تشغيل الـ API.',
      );
      setBusy(false);
    }
  }

  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden px-4 py-10">
      {/* ambient brand glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(640px 320px at 85% 8%, rgba(233,196,90,.10), transparent 60%),' +
            'radial-gradient(720px 420px at 10% 90%, rgba(45,212,191,.14), transparent 58%)',
        }}
      />
      <div className="w-full max-w-[400px]">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-teal-soft to-teal text-[20px] font-extrabold text-teal-ink shadow-[0_8px_22px_rgba(45,212,191,.3)]">
            P
          </span>
          <span className="text-2xl font-extrabold">
            باترون<span className="text-gold">.</span>
          </span>
        </div>

        <div className="surface rounded-2xl p-7 shadow-card">
          <h1 className="text-xl font-bold">تسجيل الدخول</h1>
          <p className="mt-1 text-sm text-muted">ادخل إلى لوحة تحكم المتجر.</p>

          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-sm font-semibold">
                البريد الإلكتروني
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@patron.io"
                dir="ltr"
                className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-sm font-semibold">
                كلمة المرور
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                dir="ltr"
                className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
              />
            </div>

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
              className="mt-1 rounded-xl bg-teal py-3 text-[15px] font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
            >
              {busy ? 'جارٍ الدخول…' : 'دخول'}
            </button>
          </form>
        </div>

        <p className="mt-5 text-center text-xs text-muted">
          لوحة إدارة باترون — للموظّفين المصرّح لهم فقط.
        </p>
      </div>
    </main>
  );
}
