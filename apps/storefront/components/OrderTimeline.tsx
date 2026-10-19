import type { Order } from '@/lib/types';
import { CheckIcon } from './icons';

type Step = { t: string; d?: string; state: 'done' | 'now' | 'todo' };

function when(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  return new Date(iso).toLocaleString('ar', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Where an order stands, in the four steps a customer cares about. */
function steps(order: Order): Step[] | null {
  const s = order.status;
  if (['CANCELLED', 'FAILED', 'REFUNDED'].includes(s)) return null;
  const latest = [...(order.payments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const reviewing = s === 'PENDING_PAYMENT' && latest?.gateway === 'MANUAL' && latest.status === 'AUTHORIZED';
  const paid = !!order.paidAt || s !== 'PENDING_PAYMENT';
  const done = s === 'COMPLETED';

  return [
    { t: 'تم استلام الطلب', d: when(order.createdAt), state: 'done' },
    {
      t: paid ? 'تم تأكيد الدفع' : reviewing ? 'نراجع تحويلك' : 'بانتظار الدفع',
      d: paid ? when(order.paidAt) : reviewing ? 'نؤكّده خلال وقت قصير' : undefined,
      state: paid ? 'done' : 'now',
    },
    {
      t: s === 'PARTIALLY_COMPLETED' ? 'سُلّم جزء من الطلب' : 'نجهّز طلبك',
      state: done ? 'done' : paid ? 'now' : 'todo',
    },
    { t: 'تم التسليم', d: when(order.completedAt), state: done ? 'done' : 'todo' },
  ];
}

const ENDED: Record<string, { t: string; d: string }> = {
  CANCELLED: { t: 'أُلغي الطلب', d: 'إن كنت دفعت، راسلنا على واتساب لنعيد لك المبلغ.' },
  FAILED: { t: 'تعذّر تنفيذ الطلب', d: 'سنتواصل معك، أو راسلنا على واتساب.' },
  REFUNDED: { t: 'أُعيد المبلغ', d: 'أعدنا لك قيمة هذا الطلب.' },
};

export default function OrderTimeline({ order }: { order: Order }) {
  const list = steps(order);
  if (!list) {
    const e = ENDED[order.status];
    return (
      <div className="surface mt-5 rounded-2xl border border-bad/25 p-4 shadow-card">
        <div className="font-bold text-bad">{e?.t ?? order.status}</div>
        {e && <p className="mt-0.5 text-sm text-muted">{e.d}</p>}
      </div>
    );
  }

  return (
    <ol className="surface mt-5 rounded-2xl p-4 shadow-card sm:p-5" aria-label="حالة الطلب">
      {list.map((st, i) => (
        <li key={st.t} className="relative flex gap-3 pb-5 last:pb-0">
          {i < list.length - 1 && (
            <span
              aria-hidden
              className={`absolute start-[13px] top-7 h-[calc(100%-24px)] w-0.5 ${
                st.state === 'done' ? 'bg-ok' : 'bg-[rgb(var(--line))]'
              }`}
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
