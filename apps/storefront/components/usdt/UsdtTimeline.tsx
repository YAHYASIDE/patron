'use client';

import { locale } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { UsdtOrder } from '@/lib/usdt';
import { CheckIcon } from '../icons';

type Step = { t: string; d?: string; state: 'done' | 'now' | 'todo' };

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : undefined;

/** The four steps of a USDT order, as the customer lives them. */
export default function UsdtTimeline({ order }: { order: UsdtOrder }) {
  const t = useT();
  const s = order.status;

  if (s === 'REJECTED' || s === 'CANCELLED') {
    const expired = order.events?.some((e) => e.action === 'expired');
    return (
      <div className="surface mt-4 rounded-2xl border border-bad/25 p-4 shadow-card">
        <div className="font-bold text-bad">
          {s === 'REJECTED' ? t('رُفض الطلب') : expired ? t('انتهت مهلة الدفع') : t('أُلغي الطلب')}
        </div>
        <p className="mt-0.5 text-sm text-muted">
          {s === 'REJECTED'
            ? order.rejectReason
              ? t('السبب: {reason}', { reason: order.rejectReason })
              : t('راسلنا على واتساب لمعرفة السبب.')
            : t('إن كنت حوّلت المبلغ، راسلنا على واتساب مع رقم الطلب لنعيده لك.')}
        </p>
        {s === 'REJECTED' && order.paidAt && (
          <p className="mt-1 text-sm text-muted">{t('إن كان مبلغك قد وصلنا فسنعيده لك بنفس طريقة الدفع.')}</p>
        )}
      </div>
    );
  }

  const paid = ['READY_TO_SEND', 'COMPLETED'].includes(s);
  const steps: Step[] = [
    { t: t('أُنشئ الطلب'), d: when(order.createdAt), state: 'done' },
    {
      t: paid ? t('تأكّد وصول المبلغ') : s === 'UNDER_REVIEW' ? t('نراجع تحويلك') : t('بانتظار الدفع'),
      d: paid ? when(order.approvedAt) : s === 'UNDER_REVIEW' ? t('نتحقّق من وصول المبلغ إلى حسابنا') : undefined,
      state: paid ? 'done' : 'now',
    },
    {
      t: s === 'COMPLETED' ? t('أرسلنا USDT') : t('نرسل USDT يدويًا'),
      d: s === 'READY_TO_SEND' ? t('يُرسل من حساب المتجر خلال وقت قصير') : undefined,
      state: s === 'COMPLETED' ? 'done' : s === 'READY_TO_SEND' ? 'now' : 'todo',
    },
    { t: t('وصل إلى محفظتك'), d: when(order.completedAt), state: s === 'COMPLETED' ? 'done' : 'todo' },
  ];

  return (
    <ol className="surface mt-4 rounded-2xl p-4 shadow-card sm:p-5" aria-label={t('حالة الطلب')}>
      {steps.map((st, i) => (
        <li key={st.t} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className={`absolute start-[13px] top-7 h-[calc(100%-24px)] w-0.5 ${st.state === 'done' ? 'bg-ok' : 'bg-[rgb(var(--line))]'}`}
            />
          )}
          <span
            className={`relative grid h-7 w-7 flex-none place-items-center rounded-full ${
              st.state === 'done'
                ? 'bg-ok text-white'
                : st.state === 'now'
                  ? 'bg-teal/15 text-teal ring-2 ring-teal'
                  : 'bg-[rgb(var(--surface-2))] text-muted'
            }`}
          >
            {st.state === 'done' ? (
              <CheckIcon size={14} />
            ) : (
              <span className={`h-2 w-2 rounded-full ${st.state === 'now' ? 'animate-pulse bg-teal' : 'bg-current'}`} />
            )}
          </span>
          <div className="pt-0.5">
            <div className={`text-sm font-bold ${st.state === 'todo' ? 'text-muted' : ''}`}>{st.t}</div>
            {st.d && <div className="mt-0.5 text-xs text-muted">{st.d}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
