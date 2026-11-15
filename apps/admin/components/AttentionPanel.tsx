'use client';

import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { moneyIn, num } from '@/lib/format';

type OrderRef = {
  id: string;
  orderNumber: string;
  total: string | number;
  currency: string;
  user?: { fullName?: string | null; phone?: string | null } | null;
};
type Attention = {
  lateMinutes: number;
  total: number;
  failed: { count: number; items: (OrderRef & { minutes: number | null; error: string | null })[] };
  lateDelivery: { count: number; items: (OrderRef & { minutes: number | null })[] };
  waitingTransfers: {
    count: number;
    items: { paymentId: string; amount: string | number; currency: string; minutes: number | null; order: OrderRef }[];
  };
  duplicatePayments: {
    count: number;
    items: { paymentId: string; gateway: string; amount: string | number; currency: string; order: OrderRef }[];
  };
};

/** How long ago, the way the owner says it: "منذ 25 د" / "منذ 3 س" / "منذ يومين". */
export function ago(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '';
  if (minutes < 60) return `منذ ${num(minutes)} د`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `منذ ${num(h)} س`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : `منذ ${num(d)} أيام`;
}

const BACKUP_STALE_DAYS = 7;

function Group({
  tone,
  title,
  hint,
  count,
  children,
}: {
  tone: 'bad' | 'warn';
  title: string;
  hint: string;
  count: number;
  children: React.ReactNode;
}) {
  if (!count) return null;
  const c = tone === 'bad' ? 'border-bad/40 bg-bad/10' : 'border-warn/40 bg-warn/10';
  const t = tone === 'bad' ? 'text-bad' : 'text-warn';
  return (
    <div className={`rounded-2xl border p-4 ${c}`}>
      <div className="flex items-start gap-3">
        <span className={`tnum grid h-9 min-w-9 flex-none place-items-center rounded-xl bg-white/60 px-2 text-base font-extrabold dark:bg-black/20 ${t}`}>
          {num(count)}
        </span>
        <div className="min-w-0">
          <div className={`font-extrabold ${t}`}>{title}</div>
          <p className="text-xs text-muted">{hint}</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-[rgb(var(--line))]">{children}</ul>
    </div>
  );
}

function Row({ href, number, who, right, note }: { href: string; number: string; who?: string | null; right: string; note?: string | null }) {
  return (
    <li>
      <Link href={href} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:opacity-80">
        <span className="min-w-0">
          <span className="block whitespace-nowrap font-bold" dir="ltr">
            {number}
          </span>
          {(who || note) && (
            <span className="block truncate text-xs text-muted">
              {who}
              {who && note ? ' · ' : ''}
              {note}
            </span>
          )}
        </span>
        <span className="flex-none text-xs font-semibold text-muted">{right}</span>
      </Link>
    </li>
  );
}

/**
 * What needs the owner before anything else: paid orders whose delivery
 * failed or is late, transfers left waiting, payments taken twice, and an old
 * backup. Silent when there is nothing to do.
 */
export default function AttentionPanel() {
  const a = useFetch<Attention>('/admin/orders/attention');
  const b = useFetch<{ lastBackupAt: string | null }>('/admin/backup/status');
  const d = a.data;

  const backupDays = b.data
    ? b.data.lastBackupAt
      ? Math.floor((Date.now() - new Date(b.data.lastBackupAt).getTime()) / 86_400_000)
      : null
    : undefined;
  const backupOld = b.data && (backupDays === null || (backupDays ?? 0) >= BACKUP_STALE_DAYS);

  if (!d?.total && !backupOld) return null;
  const who = (o: OrderRef) => o.user?.fullName || o.user?.phone || null;

  return (
    <section className="flex flex-col gap-3" aria-label="طلبات تحتاج تدخّلك">
      <h2 className="text-base font-bold text-bad">تحتاج تدخّلك الآن</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        <Group
          tone="bad"
          title="طلبات مدفوعة تعذّر تسليمها"
          hint="الزبون دفع ولم يستلم: سلّمها يدويًا من صفحة الطلب أو أعد له المبلغ."
          count={d?.failed.count ?? 0}
        >
          {d?.failed.items.slice(0, 5).map((o) => (
            <Row key={o.id} href={`/orders/${o.id}`} number={o.orderNumber} who={who(o)} right={ago(o.minutes)} note={moneyIn(o.total, o.currency)} />
          ))}
        </Group>
        <Group
          tone="bad"
          title="دفعات أُخذت مرتين"
          hint="دفعة ثانية لطلب مدفوع: أعد مبلغها للزبون."
          count={d?.duplicatePayments.count ?? 0}
        >
          {d?.duplicatePayments.items.slice(0, 5).map((p) => (
            <Row key={p.paymentId} href={`/orders/${p.order.id}`} number={p.order.orderNumber} who={who(p.order)} right={moneyIn(p.amount, p.currency)} />
          ))}
        </Group>
        <Group
          tone="warn"
          title={`تحويلات تنتظر أكثر من ${num(d?.lateMinutes ?? 15)} دقيقة`}
          hint="الزبون أرسل المبلغ وينتظر تأكيدك."
          count={d?.waitingTransfers.count ?? 0}
        >
          {d?.waitingTransfers.items.slice(0, 5).map((p) => (
            <Row key={p.paymentId} href={`/orders/${p.order.id}`} number={p.order.orderNumber} who={who(p.order)} right={ago(p.minutes)} note={moneyIn(p.amount, p.currency)} />
          ))}
        </Group>
        <Group
          tone="warn"
          title={`طلبات مدفوعة لم تُسلَّم منذ أكثر من ${num(d?.lateMinutes ?? 15)} دقيقة`}
          hint="سلّمها من صفحة الطلب."
          count={d?.lateDelivery.count ?? 0}
        >
          {d?.lateDelivery.items.slice(0, 5).map((o) => (
            <Row key={o.id} href={`/orders/${o.id}`} number={o.orderNumber} who={who(o)} right={ago(o.minutes)} note={moneyIn(o.total, o.currency)} />
          ))}
        </Group>
      </div>
      {backupOld && (
        <Link
          href="/settings#backup"
          className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn"
        >
          <span className="font-extrabold">
            {backupDays === null ? 'لم تنزّل نسخة احتياطية بعد' : `آخر نسخة احتياطية قبل ${num(backupDays ?? 0)} أيام`}
          </span>
          <span className="text-xs">قاعدة البيانات المجانية قد تُحذف: نزّل نسخة كاملة واحفظها مع مفتاح التشفير.</span>
          <span className="ms-auto font-bold underline">نزّلها ←</span>
        </Link>
      )}
    </section>
  );
}
