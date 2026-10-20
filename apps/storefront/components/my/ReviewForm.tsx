'use client';

import { useState } from 'react';
import { ApiError, me } from '@/lib/api';
import { useT, tNow } from '@/lib/i18n';

const MAX = 500;

function Star({ on, size = 26 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={on ? 'text-gold' : 'text-[rgb(var(--line))]'}>
      <path
        fill="currentColor"
        d="M12 2.8l2.83 5.73 6.33.92-4.58 4.46 1.08 6.3L12 17.24l-5.66 2.97 1.08-6.3L2.84 9.45l6.33-.92L12 2.8z"
      />
    </svg>
  );
}

/**
 * Stars and a comment for a delivered item (#15). Collapsed to one link until
 * the customer opens it; after sending (or when the server says it was already
 * reviewed) the parent hides it through `onDone`.
 */
export default function ReviewForm({ orderItemId, onDone }: { orderItemId: string; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) return setError(tNow('اختر عدد النجوم أولًا.'));
    setBusy(true);
    setError(null);
    try {
      await me.review({ orderItemId, rating, comment: comment.trim() || undefined });
      setSent(true);
      setTimeout(onDone, 2500);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.code === 'ALREADY_REVIEWED')) return onDone();
      setError(err instanceof ApiError && err.status !== 0 && err.status < 500 ? err.message : tNow('تعذّر إرسال التقييم. حاول مرة أخرى.'));
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p className="mt-3 rounded-xl bg-ok/10 px-3 py-2 text-sm font-bold text-ok">{t('شكرًا لتقييمك!')}</p>;

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:underline">
        <Star on size={16} />
        {t('قيّم هذا المنتج')}
      </button>
    );

  const shown = hover || rating;
  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-[rgb(var(--line))] p-3">
      <div className="text-sm font-bold">{t('ما رأيك في هذا المنتج؟')}</div>
      <div role="radiogroup" aria-label={t('التقييم')} className="mt-2 flex gap-1" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={t('{n} من 5', { n })}
            onClick={() => setRating(n)}
            onMouseEnter={() => setHover(n)}
            className="grid h-10 w-10 place-items-center rounded-lg transition hover:bg-[rgb(var(--surface-2))]"
          >
            <Star on={n <= shown} />
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value.slice(0, MAX))}
        rows={3}
        placeholder={t('اكتب تعليقًا (اختياري)')}
        className="surface-2 hairline mt-2 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
      />
      <div className="mt-1 text-end text-[11px] text-muted tnum">
        {comment.length}/{MAX}
      </div>
      {error && <p className="mt-1 text-sm text-bad">{error}</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-brand rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60">
          {busy ? t('جارٍ الإرسال…') : t('أرسل التقييم')}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl px-3 py-2 text-sm font-bold text-muted">
          {t('إلغاء')}
        </button>
      </div>
    </form>
  );
}
