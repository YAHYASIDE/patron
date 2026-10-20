'use client';

import Link from 'next/link';
import { errorsPath, opportunitiesPath, NOT_READY, type ErrorGroup, type Opportunities } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { num } from '@/lib/format';

/** Home card: error groups in the last 24 h and the top searches that found nothing this week. */
export default function LearnCard() {
  const errors = useFetch<ErrorGroup[]>(errorsPath(1));
  const opp = useFetch<Opportunities>(opportunitiesPath(7));
  const count = errors.data?.length ?? 0;
  const misses = (opp.data?.searchMisses ?? []).slice(0, 3);
  const bad = count > 0;

  return (
    <section className="surface grid gap-3 rounded-2xl p-4 shadow-card md:grid-cols-2 md:gap-4">
      <Link href="/errors" className="flex items-center gap-3 self-start hover:opacity-80">
        <span
          className={
            'grid h-11 min-w-11 flex-none place-items-center rounded-xl px-2 text-lg font-extrabold tnum ' +
            (bad ? 'bg-bad/12 text-bad' : 'surface-2 text-muted')
          }
        >
          {errors.data ? num(count) : '—'}
        </span>
        <span className="min-w-0">
          <span className="block font-bold">أخطاء آخر 24 ساعة</span>
          <span className={`block text-xs ${bad ? 'text-bad' : 'text-muted'}`}>
            {errors.error
              ? errors.error === NOT_READY
                ? 'غير متاح بعد'
                : 'تعذّر الجلب'
              : errors.loading && !errors.data
                ? '…'
                : bad
                  ? 'افتحها وانسخ التفاصيل لمن يصلح الموقع'
                  : 'لا أخطاء — ممتاز'}
          </span>
        </span>
        <span aria-hidden className="ms-auto text-muted">
          ←
        </span>
      </Link>

      <div className="min-w-0 border-t hairline pt-3 md:border-s md:border-t-0 md:ps-4 md:pt-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold text-muted">بحثوا ولم يجدوا (7 أيام)</span>
          <Link href="/opportunities" className="flex-none text-xs font-bold text-teal hover:underline">
            الفرص ←
          </Link>
        </div>
        {opp.error ? (
          <p className="mt-2 text-xs text-muted">
            {opp.error === NOT_READY ? 'غير متاح بعد' : 'تعذّر الجلب'}
          </p>
        ) : opp.loading && !opp.data ? (
          <p className="mt-2 text-xs text-muted">…</p>
        ) : misses.length === 0 ? (
          <p className="mt-2 text-xs text-muted">لا عمليات بحث بلا نتيجة.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {misses.map((m) => (
              <li key={m.query}>
                <Link
                  href="/opportunities"
                  className="flex items-center justify-between gap-3 text-sm hover:opacity-80"
                >
                  <span dir="auto" className="min-w-0 truncate font-semibold">
                    {m.query}
                  </span>
                  <span className="flex-none whitespace-nowrap text-xs text-muted">
                    <span className="tnum font-bold">{num(m.count)}</span> مرة
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
