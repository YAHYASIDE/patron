'use client';

import { useEffect, useState } from 'react';
import { store } from '@/lib/api';
import { locale, num } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { ReviewSummary } from '@/lib/types';
import { StarIcon } from './discovery-icons';

/** Published reviews for a brand's products (GET /catalog/reviews); null until loaded, when none or on failure. */
export function useReviews(productIds: string[]): ReviewSummary | null {
  const key = productIds.slice().sort().join(',');
  const [data, setData] = useState<ReviewSummary | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    store
      .reviews(key.split(','))
      .then((r) => alive && setData(r && r.count > 0 && r.average !== null ? r : null))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [key]);
  return data;
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-gold" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
          <StarIcon size={size} filled={false} className="absolute inset-0 text-gold/40" />
          {/* partial stars fill from the start side */}
          <span
            className="absolute inset-y-0 start-0 overflow-hidden"
            style={{ width: `${Math.max(0, Math.min(1, value - i + 1)) * 100}%` }}
          >
            <StarIcon size={size} className="block" />
          </span>
        </span>
      ))}
    </span>
  );
}

/** "★★★★☆ 4.6 (23)" under the brand title. */
export function RatingLine({ summary }: { summary: ReviewSummary }) {
  const t = useT();
  const avg = summary.average ?? 0;
  return (
    <a
      href="#reviews"
      className="mt-1.5 inline-flex items-center gap-1.5 text-xs"
      aria-label={t('التقييم {avg} من 5 ({n} تقييم)', { avg: num(avg, 1), n: summary.count })}
    >
      <Stars value={avg} />
      <span className="tnum font-extrabold">{num(avg, 1)}</span>
      <span className="tnum text-muted">({summary.count})</span>
    </a>
  );
}

/** The newest reviews, with the owner's reply when there is one. */
export function ReviewList({ summary }: { summary: ReviewSummary }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const items = all ? summary.items : summary.items.slice(0, 4);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <section id="reviews" className="mt-12 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-extrabold">{t('آراء العملاء')}</h2>
        <div className="flex items-center gap-2 text-sm">
          <span className="tnum text-2xl font-extrabold">{num(summary.average ?? 0, 1)}</span>
          <div>
            <Stars value={summary.average ?? 0} size={15} />
            <div className="text-xs text-muted">{t('{n} تقييم', { n: summary.count })}</div>
          </div>
        </div>
      </div>
      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((r) => (
          <li key={r.id} className="surface rounded-2xl p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <bdi className="block min-w-0 truncate text-sm font-bold">{r.author}</bdi>
              <span className="flex-none text-xs text-muted tnum">{date(r.createdAt)}</span>
            </div>
            <div className="mt-1">
              <Stars value={r.rating} size={13} />
            </div>
            {/* customers write in any language: each text keeps its own direction */}
            {r.comment && (
              <p dir="auto" className="mt-2 break-words text-sm leading-relaxed [text-align:match-parent]">
                {r.comment}
              </p>
            )}
            {r.reply && (
              <div className="mt-3 rounded-xl bg-[rgb(var(--surface-2))] px-3 py-2 text-sm">
                <div className="text-xs font-bold text-teal">{t('ردّ المتجر')}</div>
                <p dir="auto" className="mt-0.5 break-words leading-relaxed text-muted [text-align:match-parent]">
                  {r.reply}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!all && summary.items.length > 4 && (
        <button onClick={() => setAll(true)} className="mt-3 text-sm font-bold text-teal hover:underline">
          {t('عرض المزيد من التقييمات')}
        </button>
      )}
    </section>
  );
}
