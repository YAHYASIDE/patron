'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { date, dateTime, moneyIn } from '@/lib/format';

/** Customer segments, derived by the API (customer-segments.ts): new, active, VIP, dormant. */
export type Segment = 'new' | 'active' | 'vip' | 'dormant';

export const SEGMENTS: { id: Segment; label: string; hint: string; cls: string }[] = [
  { id: 'new', label: 'جديد', hint: 'حساب عمره أقل من 30 يومًا', cls: 'bg-teal/12 text-teal' },
  { id: 'active', label: 'نشط', hint: 'طلب مدفوع في آخر 30 يومًا', cls: 'bg-ok/12 text-ok' },
  { id: 'vip', label: 'مميز VIP', hint: 'تجاوز حدّ الإنفاق أو عدد الطلبات', cls: 'bg-gold/15 text-gold-deep' },
  { id: 'dormant', label: 'خامل', hint: 'لا طلب مدفوع منذ 90 يومًا', cls: 'bg-ink-400/15 text-muted' },
];

export function SegmentChips({ segments }: { segments?: Segment[] }) {
  if (!segments?.length) return null;
  return (
    <>
      {SEGMENTS.filter((s) => segments.includes(s.id)).map((s) => (
        <span key={s.id} title={s.hint} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
          {s.label}
        </span>
      ))}
    </>
  );
}

/** Filter chips for the customers list. */
export function SegmentFilter({ value, onChange }: { value: Segment | ''; onChange: (v: Segment | '') => void }) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="الشرائح">
      {[{ id: '' as const, label: 'الكل', hint: 'كل الزبائن' }, ...SEGMENTS].map((s) => (
        <button
          key={s.id || 'all'}
          role="tab"
          aria-selected={value === s.id}
          title={s.hint}
          onClick={() => onChange(s.id)}
          className={
            'whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-bold transition ' +
            (value === s.id ? 'border-teal bg-teal text-white' : 'border-[rgb(var(--line))] text-muted hover:border-teal')
          }
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

type Settings = { vipSpendBase: number; vipOrders: number };

/** The VIP thresholds (the owner's choice); the other segments are fixed day counts. */
export function VipSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.get<Settings>('/admin/customers/segments/settings').then(setS).catch(() => setS(null));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setMsg(null);
    try {
      setS(await api.put<Settings>('/admin/customers/segments/settings', s));
      setMsg({ ok: true, text: 'حُفظ.' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.status === 403 ? 'ليست لديك صلاحية.' : 'تعذّر الحفظ.' });
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  const input = 'surface-2 hairline min-h-11 w-full rounded-xl border px-3 py-2 text-base outline-none focus:border-teal';
  return (
    <div className="text-sm">
      <button onClick={() => setOpen((v) => !v)} className="font-semibold text-teal hover:underline" aria-expanded={open}>
        {open ? 'إخفاء' : 'متى يصبح الزبون مميزًا؟'}
      </button>
      {open && (
        <form onSubmit={save} className="surface mt-2 grid gap-3 rounded-2xl p-4 shadow-card sm:grid-cols-3 sm:items-end">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">مجموع مشترياته على الأقل ($)</span>
            <input
              type="number" min={0} step="0.01" inputMode="decimal" dir="ltr" className={input}
              value={s.vipSpendBase} onChange={(e) => setS({ ...s, vipSpendBase: Number(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">أو عدد طلباته المدفوعة على الأقل</span>
            <input
              type="number" min={0} step={1} inputMode="numeric" dir="ltr" className={input}
              value={s.vipOrders} onChange={(e) => setS({ ...s, vipOrders: Math.max(0, Math.floor(Number(e.target.value))) })}
            />
          </label>
          <button disabled={busy} className="min-h-11 rounded-xl bg-teal px-4 text-sm font-bold text-white disabled:opacity-50">
            حفظ
          </button>
          <p className="text-xs text-muted sm:col-span-3">صفر يوقف القاعدة. «جديد» أقل من 30 يومًا، «نشط» طلب في آخر 30 يومًا، «خامل» لا طلب منذ 90 يومًا.</p>
          {msg && <p className={`text-xs font-bold sm:col-span-3 ${msg.ok ? 'text-ok' : 'text-bad'}`}>{msg.text}</p>}
        </form>
      )}
    </div>
  );
}

// ── Customer page extras: who referred them, and the money that went back ──

export type CustomerRefund = {
  id: string;
  amount: string;
  currency: string;
  status: 'REQUESTED' | 'APPROVED' | 'PROCESSED' | 'REJECTED';
  reason: string;
  toWallet: boolean;
  createdAt: string;
  processedAt: string | null;
  order: { id: string; orderNumber: string };
};

export type ReferringAgent = { id: string; code: string; isActive: boolean; user: { id: string; fullName: string } } | null;

const REFUND_STATUS: Record<CustomerRefund['status'], { label: string; cls: string }> = {
  REQUESTED: { label: 'مطلوب', cls: 'bg-warn/12 text-warn' },
  APPROVED: { label: 'موافق عليه', cls: 'bg-teal/12 text-teal' },
  PROCESSED: { label: 'تم', cls: 'bg-ok/12 text-ok' },
  REJECTED: { label: 'مرفوض', cls: 'bg-ink-400/15 text-muted' },
};

export function ReferralCard({
  referredBy,
  agent,
  phone,
  name,
}: {
  referredBy?: ReferringAgent;
  agent?: { id: string; code: string; isActive: boolean } | null;
  phone?: string | null;
  name?: string;
}) {
  if (referredBy === undefined && agent === undefined) return null;
  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">الإحالة</h2>
      {referredBy ? (
        <p className="text-sm">
          جاء عن طريق المندوب{' '}
          <Link href={`/agents/${referredBy.id}`} className="font-bold text-teal hover:underline">
            {referredBy.user.fullName}
          </Link>{' '}
          <span dir="ltr" className="font-mono text-xs text-muted">{referredBy.code}</span>
          {!referredBy.isActive && <span className="ms-2 rounded-full bg-ink-400/15 px-2 py-0.5 text-[11px] font-bold text-muted">موقوف</span>}
        </p>
      ) : (
        <p className="text-sm text-muted">لم يأتِ عن طريق مندوب.</p>
      )}
      {agent ? (
        <Link
          href={`/agents/${agent.id}`}
          className="rounded-xl border border-[rgb(var(--line))] px-4 py-2.5 text-sm font-bold hover:border-teal"
        >
          هذا الزبون مندوب — رمزه <span dir="ltr" className="font-mono">{agent.code}</span>
        </Link>
      ) : (
        agent === null &&
        phone && (
          <Link
            href={`/agents?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name ?? '')}`}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2.5 text-center text-sm font-bold hover:border-teal"
          >
            اجعله مندوبًا
          </Link>
        )
      )}
      <p className="text-xs text-muted">لا يرى الزبون هذه المعلومات.</p>
    </section>
  );
}

export function RefundsCard({ refunds }: { refunds?: CustomerRefund[] }) {
  if (!refunds) return null;
  return (
    <section className="surface overflow-hidden rounded-2xl shadow-card">
      <h2 className="px-5 py-4 text-base font-bold">المبالغ المسترجعة</h2>
      {refunds.length === 0 && <p className="px-5 pb-5 text-sm text-muted">لا استرجاع على طلباته.</p>}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))] border-t hairline">
        {refunds.map((r) => (
          <Link
            key={r.id}
            href={`/orders/${r.order.id}`}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-[rgb(var(--surface-2))]"
          >
            <span className="min-w-0">
              <span className="block font-semibold" dir="ltr">{r.order.orderNumber}</span>
              <span className="block text-xs text-muted">
                {r.processedAt ? dateTime(r.processedAt) : date(r.createdAt)} · {r.toWallet ? 'إلى المحفظة' : 'إلى وسيلة الدفع'}
              </span>
              <span className="block break-words text-xs text-muted">{r.reason}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${REFUND_STATUS[r.status].cls}`}>
                {REFUND_STATUS[r.status].label}
              </span>
              <span className="tnum whitespace-nowrap font-bold">{moneyIn(r.amount, r.currency)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
