'use client';

import { use, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { locale, money, num } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { usdt } from '@/lib/usdt';
import { ChevronIcon } from '@/components/icons';
import { CopyText, StatusChip, explorerUrl, usdtAmount, NETWORK_INFO } from '@/components/usdt/shared';
import UsdtTimeline from '@/components/usdt/UsdtTimeline';
import UsdtPayment from '@/components/usdt/UsdtPayment';

/** One USDT order: what was bought, where it goes, paying for it, and where it stands. */
export default function UsdtOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    if (!isAuthed()) router.replace(`/login?next=/usdt/${id}`);
  }, [router, id]);

  const res = useFetch(() => usdt.order(id), [id]);
  const order = res.data;

  // while staff work on it, look again now and then
  const waiting = order && ['UNDER_REVIEW', 'READY_TO_SEND'].includes(order.status);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => res.reload(), 30_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  if (res.loading && !order) return <div className="mx-auto max-w-[620px] px-4 py-16 text-center text-sm text-muted">{t('جارٍ التحميل…')}</div>;
  if (!order) {
    return (
      <div className="mx-auto max-w-[620px] px-4 py-16 text-center">
        <p className="text-muted">{res.error ?? t('الطلب غير موجود.')}</p>
        <Link href="/usdt" className="mt-4 inline-block font-bold text-teal">
          {t('شراء USDT')}
        </Link>
      </div>
    );
  }

  const link = order.txid ? explorerUrl(order.network, order.txid) : null;

  return (
    <div className="mx-auto max-w-[620px] px-4 py-6 sm:py-8">
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/usdt" className="hover:text-[rgb(var(--text))]">
          USDT
        </Link>
        <ChevronIcon size={14} className="ltr:rotate-180" />
        <span dir="ltr" className="truncate text-[rgb(var(--text))]">
          {order.number}
        </span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tnum">{usdtAmount(order.amountUsdt)}</h1>
        <StatusChip status={order.status} />
      </div>

      <section className="surface mt-4 rounded-2xl p-4 shadow-card sm:p-5">
        <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-sm">
          <dt className="text-muted">{t('السعر')}</dt>
          <dd className="tnum text-end">1 USDT = {money(order.rate, order.currency, 2)}</dd>
          <dt className="text-muted">{t('قيمة USDT')}</dt>
          <dd className="tnum text-end">{money(order.subtotal, order.currency)}</dd>
          <dt className="text-muted">{t('رسوم الخدمة')}</dt>
          <dd className="tnum text-end">{money(order.fee, order.currency)}</dd>
          <dt className="border-t border-[rgb(var(--line))] pt-2 font-bold">{t('المجموع')}</dt>
          <dd className="tnum border-t border-[rgb(var(--line))] pt-2 text-end font-extrabold text-teal">{money(order.total, order.currency)}</dd>
        </dl>
        <div className="mt-4 text-sm font-bold">
          {order.delivery === 'BINANCE' ? t('إلى حسابك في Binance') : t('إلى محفظتك على شبكة {network}', { network: order.network ? t(NETWORK_INFO[order.network].name) : '' })}
        </div>
        <div className="mt-2">
          <CopyText text={(order.delivery === 'BINANCE' ? order.binanceId : order.address) ?? ''} label={t('العنوان')} />
        </div>
      </section>

      <UsdtTimeline order={order} />

      {order.status === 'COMPLETED' && order.txid && (
        <section className="surface mt-4 rounded-2xl border border-ok/30 p-4 shadow-card sm:p-5">
          <div className="font-bold text-ok">{t('أرسلنا USDT إليك')}</div>
          <p className="mt-1 text-sm text-muted">{t('رقم العملية (TXID) للتحقّق منها في محفظتك:')}</p>
          <div className="mt-2">
            <CopyText text={order.txid} label="TXID" />
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-bold text-teal">
              {t('افتح العملية في مستكشف الشبكة')}
            </a>
          )}
        </section>
      )}

      {(order.status === 'AWAITING_PAYMENT' || order.status === 'UNDER_REVIEW') && <UsdtPayment order={order} onChange={res.reload} />}

      {order.events && order.events.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer font-bold text-muted">{t('سجلّ الطلب')}</summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {order.events.map((e, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>{t(EVENT_LABEL[e.action] ?? e.action)}{e.note ? `: ${e.note}` : ''}</span>
                <span className="tnum flex-none text-xs text-muted">{new Date(e.at).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-6 text-xs text-muted">
        {t('رقم الطلب:')} <span dir="ltr">{order.number}</span> · {num(order.amountUsdt, 2)} USDT
      </p>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  created: 'أُنشئ الطلب',
  'proof.attached': 'أُرفقت صورة التحويل',
  'payment.submitted': 'أبلغت عن التحويل',
  'payment.updated': 'صحّحت بيانات التحويل',
  approved: 'تأكّد وصول المبلغ',
  completed: 'أُرسل USDT',
  rejected: 'رُفض الطلب',
  cancelled: 'ألغيت الطلب',
  expired: 'انتهت مهلة الدفع',
};
