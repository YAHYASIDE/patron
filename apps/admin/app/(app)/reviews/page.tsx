'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { rowsOf, useFetch } from '@/lib/hooks';
import { date } from '@/lib/format';
import Notice from '@/components/Notice';

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  isPublished: boolean;
  reply: string | null;
  createdAt: string;
  product?: { id: string; nameAr: string; sku?: string } | null;
  user?: { id?: string; fullName: string } | null;
  customer?: { id?: string; fullName: string } | null;
};

const FILTERS = [
  { key: '', label: 'الكل' },
  { key: 'true', label: 'ظاهرة' },
  { key: 'false', label: 'مخفية' },
];

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية إدارة التقييمات.';
  return e.message;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="text-gold" aria-label={`${n} من 5`} dir="ltr">
      {'★'.repeat(n)}
      <span className="text-[rgb(var(--line))]">{'★'.repeat(Math.max(0, 5 - n))}</span>
    </span>
  );
}

/** Customers' ratings: hide one from the store, or answer it publicly. */
export default function ReviewsPage() {
  const [published, setPublished] = useState('');
  const list = useFetch<Review[] | { data: Review[] }>(
    `/admin/reviews${published ? `?published=${published}` : ''}`,
  );
  const rows = rowsOf(list.data);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">التقييمات</h1>
        <p className="mt-1 text-sm text-muted">
          تقييمات الزبائن بعد التسليم. المخفي لا يظهر في المتجر، وردّك يظهر تحت التقييم.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setPublished(f.key)}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (published === f.key
                ? 'bg-teal text-white'
                : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          لا تقييمات هنا.
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((r) => (
          <ReviewCard key={r.id} r={r} onChanged={list.reload} />
        ))}
      </div>
    </div>
  );
}

function ReviewCard({ r, onChanged }: { r: Review; onChanged: () => void }) {
  const [reply, setReply] = useState(r.reply ?? '');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = r.user ?? r.customer;

  useEffect(() => setReply(r.reply ?? ''), [r.reply]);

  async function patch(body: { isPublished?: boolean; reply?: string | null }) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/admin/reviews/${r.id}`, body);
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={
        'surface flex flex-col gap-3 rounded-2xl p-4 shadow-card ' + (r.isPublished ? '' : 'opacity-80')
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Stars n={r.rating} />
          <div className="mt-0.5 truncate text-sm font-bold">
            {r.product ? (
              <Link href={`/products/${r.product.id}`} className="hover:underline">
                {r.product.nameAr}
              </Link>
            ) : (
              '—'
            )}
          </div>
          <div className="text-xs text-muted">
            {who?.id ? (
              <Link href={`/customers/${who.id}`} className="hover:underline">
                {who.fullName}
              </Link>
            ) : (
              (who?.fullName ?? 'زبون')
            )}{' '}
            · {date(r.createdAt)}
          </div>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${
            r.isPublished ? 'bg-ok/12 text-ok' : 'bg-ink-400/15 text-muted'
          }`}
        >
          {r.isPublished ? 'ظاهر' : 'مخفي'}
        </span>
      </div>

      {r.comment ? (
        <p className="whitespace-pre-line break-words text-sm">{r.comment}</p>
      ) : (
        <p className="text-sm text-muted">بلا تعليق.</p>
      )}

      {r.reply && !open && (
        <div className="surface-2 rounded-xl px-3.5 py-2.5 text-sm">
          <div className="text-xs font-bold text-teal">ردّك</div>
          <p className="mt-0.5 whitespace-pre-line break-words">{r.reply}</p>
        </div>
      )}

      {open && (
        <div className="flex flex-col gap-2">
          <textarea
            rows={3}
            maxLength={500}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="شكرًا على تقييمك…"
            className="surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none focus:border-teal"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || !reply.trim()}
              onClick={() => patch({ reply: reply.trim() })}
              className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ…' : 'نشر الرد'}
            </button>
            {r.reply && (
              <button
                disabled={busy}
                onClick={() => patch({ reply: null })}
                className="rounded-xl border border-bad/40 px-4 py-2 text-sm font-bold text-bad hover:bg-bad/10"
              >
                حذف الرد
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false);
                setReply(r.reply ?? '');
              }}
              className="px-2 text-sm font-bold text-muted"
            >
              إلغاء
            </button>
          </div>
        </div>
      )}

      {error && <Notice text={error} />}

      {!open && (
        <div className="flex gap-2">
          <button
            onClick={() => setOpen(true)}
            className="hairline flex-1 rounded-xl border py-2 text-sm font-bold hover:border-teal"
          >
            {r.reply ? 'تعديل الرد' : 'رد'}
          </button>
          <button
            disabled={busy}
            onClick={() => patch({ isPublished: !r.isPublished })}
            className="hairline flex-1 rounded-xl border py-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))] disabled:opacity-50"
          >
            {r.isPublished ? 'إخفاء' : 'إظهار'}
          </button>
        </div>
      )}
    </section>
  );
}
