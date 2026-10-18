'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, ApiError } from '@/lib/api';

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/account';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.login(email.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.status === 401
            ? 'البريد أو كلمة المرور غير صحيحة.'
            : err.message
          : 'تعذّر الاتصال بالخادم.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-12">
      <div className="mx-auto max-w-[420px]">
        <h1 className="text-center text-2xl font-extrabold">تسجيل الدخول</h1>
        <p className="mt-1 text-center text-sm text-muted">ادخل لإتمام طلبك ومتابعة مشترياتك.</p>

        <form onSubmit={onSubmit} className="surface mt-7 flex flex-col gap-4 rounded-2xl p-6 shadow-card">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">البريد الإلكتروني</label>
            <input
              type="email"
              dir="ltr"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">كلمة المرور</label>
            <input
              type="password"
              dir="ltr"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-brand mt-1 rounded-xl py-3 text-[15px] font-bold disabled:opacity-60">
            {busy ? 'جارٍ الدخول…' : 'دخول'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          ليس لديك حساب؟{' '}
          <Link href={`/register?next=${encodeURIComponent(next)}`} className="font-bold text-teal hover:underline">
            أنشئ حسابًا
          </Link>
        </p>
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
