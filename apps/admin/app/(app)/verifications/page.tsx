'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';

type Pending = {
  id: string;
  purpose: 'PHONE_VERIFY' | 'PHONE_LOGIN' | 'PASSWORD_RESET';
  code: string;
  createdAt: string;
  expiresAt: string;
  sentAt: string | null;
  user: { id: string; fullName: string; phone: string | null };
};

const PURPOSE: Record<Pending['purpose'], string> = {
  PHONE_VERIFY: 'توثيق الحساب',
  PHONE_LOGIN: 'دخول من جهاز جديد',
  PASSWORD_RESET: 'نسي كلمة المرور',
};

function whatsappLink(p: Pending) {
  const digits = (p.user.phone ?? '').replace(/\D/g, '');
  const text = `مرحبًا ${p.user.fullName}، رمز التحقق الخاص بك في متجر patron هو: ${p.code}\nلا تشاركه مع أي أحد.`;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

function minutesLeft(iso: string) {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

export default function VerificationsPage() {
  const [rows, setRows] = useState<Pending[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<Pending[]>('/admin/verifications/pending'));
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError && e.status === 403 ? 'ليست لديك صلاحية لرموز التحقق.' : 'تعذّر جلب الرموز.',
      );
    }
  }

  // new requests arrive while the page is open
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  function send(p: Pending) {
    // open WhatsApp first, in the click itself, so the browser does not block it
    window.open(whatsappLink(p), '_blank', 'noopener');
    setRows(
      (list) => list?.map((r) => (r.id === p.id ? { ...r, sentAt: new Date().toISOString() } : r)) ?? null,
    );
    api.post(`/admin/verifications/${p.id}/sent`).catch(() => undefined);
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">رموز التحقق</h1>
        <p className="mt-1 text-sm text-muted">
          زبائن طلبوا رمزًا لتوثيق رقمهم. اضغط «إرسال عبر واتساب» فتُفتح المحادثة والرسالة جاهزة، ثم اضغط
          إرسال في واتساب.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>
      )}

      {rows === null && !error && <p className="text-sm text-muted">جارٍ التحميل…</p>}

      {rows?.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-12 text-center text-sm text-muted">
          لا توجد رموز بانتظار الإرسال. تظهر هنا تلقائيًا عند طلب زبون.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows?.map((p) => (
          <section key={p.id} className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-bold">{p.user.fullName}</div>
                <div dir="ltr" className="text-sm text-muted">
                  {p.user.phone}
                </div>
              </div>
              <span className="whitespace-nowrap rounded-full bg-teal/12 px-2.5 py-1 text-xs font-bold text-teal">
                {PURPOSE[p.purpose] ?? 'رمز تحقق'}
              </span>
            </div>

            <div
              dir="ltr"
              className="surface-2 select-all rounded-xl py-3 text-center font-mono text-3xl font-extrabold tracking-[0.3em]"
            >
              {p.code}
            </div>

            <div className="flex items-center justify-between text-xs text-muted">
              <span>طُلب {dateTime(p.createdAt)}</span>
              <span>ينتهي بعد {minutesLeft(p.expiresAt)} دقيقة</span>
            </div>

            <button
              onClick={() => send(p)}
              className={
                'rounded-xl py-3 text-sm font-bold text-white transition hover:opacity-90 ' +
                (p.sentAt ? 'bg-ink-500' : 'bg-[#1FA855]')
              }
            >
              {p.sentAt ? 'أُرسل · إرسال مرة أخرى' : 'إرسال عبر واتساب'}
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}
