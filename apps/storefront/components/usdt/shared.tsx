'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { num } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { UsdtNetwork, UsdtStatus } from '@/lib/usdt';

export const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

/** What each network is, in words a first-time buyer understands. */
export const NETWORK_INFO: Record<UsdtNetwork, { name: string; hint: string }> = {
  TRC20: { name: 'TRC20 (ترون)', hint: 'رسوم منخفضة. العنوان يبدأ بالحرف T.' },
  BEP20: { name: 'BEP20 (BNB Smart Chain)', hint: 'رسوم منخفضة. العنوان يبدأ بـ 0x.' },
  ERC20: { name: 'ERC20 (إيثريوم)', hint: 'رسوم الشبكة أعلى. العنوان يبدأ بـ 0x.' },
};

export const STATUS: Record<UsdtStatus, { t: string; c: string }> = {
  NEW: { t: 'جديد', c: 'bg-ink-400/15 text-muted' },
  AWAITING_PAYMENT: { t: 'بانتظار الدفع', c: 'bg-warn/12 text-warn' },
  UNDER_REVIEW: { t: 'نراجع تحويلك', c: 'bg-teal/12 text-teal' },
  READY_TO_SEND: { t: 'جاري الإرسال', c: 'bg-teal/12 text-teal' },
  COMPLETED: { t: 'تم الإرسال', c: 'bg-ok/12 text-ok' },
  REJECTED: { t: 'مرفوض', c: 'bg-bad/12 text-bad' },
  CANCELLED: { t: 'ملغي', c: 'bg-ink-400/15 text-muted' },
};

export function StatusChip({ status }: { status: UsdtStatus }) {
  const t = useT();
  const s = STATUS[status] ?? { t: status, c: 'bg-ink-400/15 text-muted' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${s.c}`}>{t(s.t)}</span>;
}

/** USDT amounts: two decimals, Latin digits. */
export const usdtAmount = (v: string | number) => `${num(v, 2)} USDT`;

/** Where to look a transaction up (opens the public explorer, nothing is sent from here). */
export function explorerUrl(network: UsdtNetwork | null, txid: string): string | null {
  if (network === 'TRC20') return `https://tronscan.org/#/transaction/${txid}`;
  if (network === 'BEP20') return `https://bscscan.com/tx/${txid}`;
  if (network === 'ERC20') return `https://etherscan.io/tx/${txid}`;
  return null;
}

export function CopyText({ text, label }: { text: string; label?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(timer);
  }, [done]);
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[rgb(var(--surface))] px-3 py-2.5">
      <span dir="ltr" className="min-w-0 select-all break-all font-mono text-[13px] font-bold sm:text-sm" aria-label={label}>
        {text}
      </span>
      <button
        type="button"
        onClick={() =>
          navigator.clipboard
            .writeText(text)
            .then(() => setDone(true))
            .catch(() => undefined)
        }
        className="min-h-10 flex-none rounded-lg border border-[rgb(var(--line))] px-3.5 py-2 text-sm font-bold text-muted"
      >
        {done ? t('نُسخ ✓') : t('نسخ')}
      </button>
    </div>
  );
}

/** The service is off (the owner has not opened it). */
export function UsdtOff() {
  const t = useT();
  return (
    <div className="mx-auto max-w-[520px] px-4 py-16 text-center">
      <h1 className="text-xl font-extrabold">{t('شراء USDT غير متاح حاليًا')}</h1>
      <p className="mt-2 text-sm text-muted">{t('هذه الخدمة متوقفة الآن. تابعنا، وسنعلن عنها عند فتحها.')}</p>
      <Link href="/" className="btn-brand mt-6 inline-block rounded-xl px-6 py-3 font-bold">
        {t('العودة إلى المتجر')}
      </Link>
    </div>
  );
}
