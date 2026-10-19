'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, auth } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { Me } from '@/lib/types';
import { money } from '@/lib/format';
import { refreshMe } from '@/lib/session';
import { VerifySheet } from '@/components/VerifyPanel';
import { CheckIcon, ShieldIcon, UserIcon } from '@/components/icons';
import { BagIcon, BellIcon, ChatIcon, HeartIcon, KeyIcon, WalletIcon } from '@/components/my/icons';
import ProfileForm from '@/components/my/ProfileForm';
import SavedInputs from '@/components/my/SavedInputs';
import { useT } from '@/lib/i18n';

const LINKS = [
  { href: '/orders', label: 'طلباتي', Icon: BagIcon },
  { href: '/codes', label: 'أكوادي', Icon: KeyIcon },
  { href: '/favorites', label: 'المفضّلة', Icon: HeartIcon },
  { href: '/wallet', label: 'المحفظة', Icon: WalletIcon },
  { href: '/notifications', label: 'الإشعارات', Icon: BellIcon },
  { href: '/support', label: 'طلبات الدعم', Icon: ChatIcon },
];

export default function AccountPage() {
  const router = useRouter();
  const t = useT();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/account');
  }, [router]);

  const me = useFetch<Me>(() => auth.me(), []);
  const [verifying, setVerifying] = useState(false);

  async function onLogout() {
    await auth.logout();
    refreshMe();
    router.replace('/login');
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('حسابي')}</h1>

      {me.loading && !me.data && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {me.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {me.error}
        </div>
      )}

      {me.data && (
        <>
          <div className="surface mt-6 rounded-2xl p-5 shadow-card">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 flex-none place-items-center rounded-2xl bg-teal/12 text-teal">
                <UserIcon size={24} />
              </span>
              <div className="min-w-0">
                <div className="break-words text-lg font-extrabold">{me.data.fullName}</div>
                {me.data.email && (
                  <div className="break-all text-sm text-muted" dir="ltr">
                    {me.data.email}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[rgb(var(--line))] pt-4 text-sm">
              <span className="text-muted">{t('واتساب')}</span>
              <span className="flex flex-wrap items-center gap-2">
                {me.data.phone && (
                  <span dir="ltr" className="font-semibold">
                    {me.data.phone}
                  </span>
                )}
                {me.data.phoneVerifiedAt ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ok/12 px-2 py-0.5 text-xs font-bold text-ok">
                    <CheckIcon size={12} /> {t('موثّق')}
                  </span>
                ) : (
                  <button
                    onClick={() => setVerifying(true)}
                    className="inline-flex items-center gap-1 rounded-full bg-warn/12 px-2.5 py-1 text-xs font-bold text-warn"
                  >
                    <ShieldIcon size={12} /> {t('غير موثّق · وثّقه')}
                  </button>
                )}
              </span>
            </div>
            {verifying && (
              <VerifySheet
                onClose={() => {
                  setVerifying(false);
                  me.reload();
                }}
              />
            )}
          </div>

          <nav aria-label={t('حسابي')} className="mt-4 grid grid-cols-3 gap-2.5 sm:grid-cols-6">
            {LINKS.map(({ href, label, Icon }) => (
              <Link
                key={href}
                href={href}
                className="surface flex min-w-0 flex-col items-center gap-2 rounded-2xl px-2 py-4 text-center shadow-card transition hover:border-teal"
              >
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-teal/10 text-teal">
                  <Icon size={20} />
                </span>
                <span className="w-full break-words text-[13px] font-bold leading-tight">{t(label)}</span>
              </Link>
            ))}
          </nav>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ProfileForm me={me.data} />
              <SavedInputs />
            </div>

            <div className="space-y-6">
              <Link href="/wallet" className="surface block rounded-2xl p-5 shadow-card transition hover:border-teal">
                <h2 className="text-base font-bold">{t('المحفظة')}</h2>
                {(me.data.wallets?.length ?? 0) === 0 ? (
                  <p className="mt-3 text-sm text-muted">{t('لا يوجد رصيد بعد.')}</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {me.data.wallets!.map((w) => (
                      <div key={w.currencyCode} className="flex items-center justify-between gap-2">
                        <span className="text-sm text-muted">{w.currencyCode}</span>
                        <span className="tnum font-extrabold text-teal">{money(w.balance, w.currencyCode)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <span className="mt-3 inline-block text-sm font-bold text-teal">{t('سجلّ الحركات')}</span>
              </Link>
              <button
                onClick={onLogout}
                className="w-full rounded-xl border border-[rgb(var(--line))] px-4 py-3 text-sm font-bold text-muted transition hover:text-bad"
              >
                {t('تسجيل الخروج')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
