'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { rowsOf, useFetch } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import Notice from '@/components/Notice';

type Status = 'OPEN' | 'ANSWERED' | 'CLOSED';
type Ticket = {
  id: string;
  subject: string;
  message: string;
  status: Status;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  user?: { id: string; fullName: string; phone?: string | null } | null;
  customer?: { id: string; fullName: string; phone?: string | null } | null;
  order?: { id: string; orderNumber: string } | null;
};

const TABS: { key: Status | ''; label: string }[] = [
  { key: 'OPEN', label: 'مفتوحة' },
  { key: 'ANSWERED', label: 'تم الرد' },
  { key: 'CLOSED', label: 'مغلقة' },
  { key: '', label: 'الكل' },
];
const STATUS: Record<Status, { t: string; c: string }> = {
  OPEN: { t: 'مفتوحة', c: 'bg-warn/12 text-warn' },
  ANSWERED: { t: 'تم الرد', c: 'bg-ok/12 text-ok' },
  CLOSED: { t: 'مغلقة', c: 'bg-ink-400/15 text-muted' },
};

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية الرد على الزبائن.';
  return e.message;
}

/** Customers' "problem with this order" requests; a reply notifies the customer in the store. */
export default function SupportPage() {
  const [status, setStatus] = useState<Status | ''>('OPEN');
  const list = useFetch<Ticket[] | { data: Ticket[] }>(
    `/admin/support/tickets${status ? `?status=${status}` : ''}`,
  );
  const rows = rowsOf(list.data);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">طلبات الدعم</h1>
        <p className="mt-1 text-sm text-muted">
          مشاكل يرسلها الزبائن من صفحة الطلب. ردّك يصلهم إشعارًا في المتجر ويصبح الطلب «تم الرد».
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key || 'all'}
            onClick={() => setStatus(t.key)}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (status === t.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          {status === 'OPEN' ? 'لا طلبات تنتظر ردّك.' : 'لا طلبات هنا.'}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((t) => (
          <TicketCard key={t.id} t={t} onChanged={list.reload} />
        ))}
      </div>
    </div>
  );
}

function TicketCard({ t, onChanged }: { t: Ticket; onChanged: () => void }) {
  const [reply, setReply] = useState(t.reply ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = t.user ?? t.customer;
  const s = STATUS[t.status] ?? STATUS.OPEN;

  useEffect(() => setReply(t.reply ?? ''), [t.reply]);

  async function patch(body: { reply?: string; status?: Status }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/support/tickets/${t.id}`, body);
      onChanged();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words font-bold">{t.subject}</h2>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            {who && (
              <Link href={`/customers/${who.id}`} className="font-semibold hover:underline">
                {who.fullName}
              </Link>
            )}
            {t.order && (
              <Link
                href={`/orders/${t.order.id}`}
                className="font-semibold text-teal hover:underline"
                dir="ltr"
              >
                {t.order.orderNumber}
              </Link>
            )}
            <span>{dateTime(t.createdAt)}</span>
          </div>
        </div>
        <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${s.c}`}>{s.t}</span>
      </div>

      <p className="surface-2 whitespace-pre-line break-words rounded-xl px-3.5 py-2.5 text-sm">
        {t.message}
      </p>

      {t.reply && t.status !== 'OPEN' && (
        <div className="rounded-xl border border-teal/25 bg-teal/5 px-3.5 py-2.5 text-sm">
          <div className="text-xs font-bold text-teal">
            ردّك {t.repliedAt ? `· ${dateTime(t.repliedAt)}` : ''}
          </div>
          <p className="mt-0.5 whitespace-pre-line break-words">{t.reply}</p>
        </div>
      )}

      {t.status !== 'CLOSED' && (
        <div className="flex flex-col gap-2">
          <textarea
            rows={3}
            maxLength={1000}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t.status === 'ANSWERED' ? 'ردّ إضافي أو تصحيح…' : 'اكتب ردّك للزبون…'}
            className="surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-teal"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled={busy || !reply.trim() || reply.trim() === (t.reply ?? '')}
              onClick={() => patch({ reply: reply.trim() })}
              className="rounded-xl bg-teal px-5 py-2 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ…' : 'إرسال الرد'}
            </button>
            {who?.phone && (
              <a
                href={`https://wa.me/${who.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-[#1FA855]/50 px-4 py-2 text-sm font-bold text-[#1FA855]"
              >
                واتساب
              </a>
            )}
            <button
              disabled={busy}
              onClick={() => patch({ status: 'CLOSED' })}
              className="ms-auto px-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))] disabled:opacity-50"
            >
              إغلاق
            </button>
          </div>
        </div>
      )}
      {t.status === 'CLOSED' && (
        <button
          disabled={busy}
          onClick={() => patch({ status: 'OPEN' })}
          className="self-start text-sm font-bold text-teal hover:underline disabled:opacity-50"
        >
          إعادة فتح
        </button>
      )}

      {error && <Notice text={error} />}
    </section>
  );
}
