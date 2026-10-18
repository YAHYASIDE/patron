'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { auth, ApiError } from '@/lib/api';

function RegisterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') || '/account';
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.register({
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
      });
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّر إنشاء الحساب.');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-12">
      <div className="mx-auto max-w-[420px]">
        <h1 className="text-center text-2xl font-extrabold">إنشاء حساب</h1>
        <p className="mt-1 text-center text-sm text-muted">دقيقة واحدة وتبدأ التسوّق.</p>

        <form onSubmit={onSubmit} className="surface mt-7 flex flex-col gap-4 rounded-2xl p-6 shadow-card">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">الاسم الكامل</label>
            <input
              required
              value={form.fullName}
              onChange={(e) => set('fullName', e.target.value)}
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">البريد الإلكتروني</label>
            <input
              type="email"
              dir="ltr"
              required
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">رقم الهاتف (اختياري)</label>
            <input
              type="tel"
              dir="ltr"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+218..."
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">كلمة المرور</label>
            <input
              type="password"
              dir="ltr"
              required
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] text-right outline-none focus:border-teal"
            />
            <span className="text-xs text-muted">١٠ أحرف فأكثر، تتضمّن حرفًا كبيرًا وصغيرًا ورقمًا.</span>
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-brand mt-1 rounded-xl py-3 text-[15px] font-bold disabled:opacity-60">
            {busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-muted">
          لديك حساب؟{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-teal hover:underline">
            سجّل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="py-20 text-center text-muted">جارٍ التحميل…</div>}>
      <RegisterInner />
    </Suspense>
  );
}
