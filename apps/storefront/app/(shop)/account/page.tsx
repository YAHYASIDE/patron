'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, auth } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { money } from '@/lib/format';
import { UserIcon } from '@/components/icons';

export default function AccountPage() {
  const router = useRouter();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/account');
  }, [router]);

  const me = useFetch<Me>(() => auth.me(), []);

  async function onLogout() {
    await auth.logout();
    router.replace('/');
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">حسابي</h1>

      {me.loading && <p className="mt-6 text-sm text-muted">جارٍ التحميل…</p>}
      {me.error && <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{me.error}</div>}

      {me.data && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="surface rounded-2xl p-5 shadow-card lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal/12 text-teal">
                <UserIcon size={24} />
              </span>
              <div>
                <div className="text-lg font-extrabold">{me.data.fullName}</div>
                <div className="text-sm text-muted" dir="ltr">
                  {me.data.email}
                </div>
              </div>
            </div>
            {me.data.phone && (
              <div className="mt-4 flex items-center justify-between border-t border-[rgb(var(--line))] pt-4 text-sm">
                <span className="text-muted">الهاتف</span>
                <span dir="ltr" className="font-semibold">
                  {me.data.phone}
                </span>
              </div>
            )}
            <div className="mt-4 flex gap-3">
              <Link href="/orders" className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold">
                طلباتي
              </Link>
              <button
                onClick={onLogout}
                className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted transition hover:text-bad"
              >
                تسجيل الخروج
              </button>
            </div>
          </div>

          <div className="surface rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">المحفظة</h2>
            {(me.data.wallets?.length ?? 0) === 0 ? (
              <p className="mt-3 text-sm text-muted">لا يوجد رصيد بعد.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {me.data.wallets!.map((w) => (
                  <div key={w.currencyCode} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{w.currencyCode}</span>
                    <span className="tnum font-extrabold text-teal">{money(w.balance, w.currencyCode)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
