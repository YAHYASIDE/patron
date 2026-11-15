'use client';

import { useState } from 'react';
import { errorsPath, type ErrorDays, type ErrorGroup, type ErrorSource } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
import Notice from '@/components/Notice';
import CopyButton from '@/components/CopyButton';
import PeriodSwitch from '@/components/PeriodSwitch';

const PERIODS = [
  { days: 1, label: 'آخر 24 ساعة' },
  { days: 7, label: 'آخر 7 أيام' },
  { days: 30, label: 'آخر 30 يومًا' },
] as const satisfies readonly { days: ErrorDays; label: string }[];

const SOURCE: Record<ErrorSource, { label: string; cls: string }> = {
  store: { label: 'المتجر', cls: 'bg-teal/12 text-teal' },
  admin: { label: 'لوحة التحكم', cls: 'bg-gold/15 text-gold-deep' },
  server: { label: 'الخادم', cls: 'bg-bad/12 text-bad' },
};
const sourceOf = (s: string) => SOURCE[s as ErrorSource] ?? { label: s, cls: 'bg-ink-400/15 text-muted' };

/** "Android · Chrome" from a full user agent: enough to tell the owner which phone or computer it was. */
function shortUa(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /CrOS/.test(ua)
          ? 'ChromeOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X|Macintosh/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : null;
  const browser = /FBAN|FBAV/.test(ua)
    ? 'Facebook'
    : /Instagram/.test(ua)
      ? 'Instagram'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /EdgA?\//.test(ua)
          ? 'Edge'
          : /OPR\/|Opera/.test(ua)
            ? 'Opera'
            : /Firefox\/|FxiOS/.test(ua)
              ? 'Firefox'
              : /Chrome\/|CriOS/.test(ua)
                ? 'Chrome'
                : /Safari\//.test(ua)
                  ? 'Safari'
                  : null;
  const parts = [os, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : ua.slice(0, 40);
}

/** Everything someone fixing the site needs, as plain text to paste in a chat. */
function details(e: ErrorGroup): string {
  return [
    `مصدر الخطأ: ${sourceOf(e.source).label} (${e.source})`,
    `الرسالة: ${e.message}`,
    `عدد المرات: ${e.count}`,
    `آخر مرة: ${dateTime(e.lastAt)} (${e.lastAt})`,
    `الصفحة: ${e.lastPath ?? '—'}`,
    `الجهاز: ${e.lastUa ? `${shortUa(e.lastUa)} — ${e.lastUa}` : '—'}`,
    '',
    'Stack:',
    e.stack ?? '—',
  ].join('\n');
}

/** Errors visitors ran into in the store, in this dashboard, and on the server — newest first. */
export default function ErrorsPage() {
  const [days, setDays] = useState<ErrorDays>(7);
  const { data, error, loading } = useFetch<ErrorGroup[]>(errorsPath(days));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">الأخطاء</h1>
        <p className="mt-1 text-sm text-muted">
          أخطاء ظهرت للزوار في المتجر، أو في لوحة التحكم، أو في الخادم، الأحدث أولًا. اضغط «نسخ التفاصيل»
          وأرسلها لمن يصلح الموقع.
        </p>
      </div>

      <PeriodSwitch options={PERIODS} value={days} onChange={setDays} />

      {error && <Notice text={error} />}
      {loading && !data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {data && data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          لا أخطاء — ممتاز ✅
        </div>
      )}

      <div className="flex flex-col gap-3">
        {(data ?? []).map((e) => {
          const src = sourceOf(e.source);
          const device = shortUa(e.lastUa);
          return (
            <section
              key={`${e.source}:${e.message}`}
              className="surface flex min-w-0 flex-col gap-3 rounded-2xl p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${src.cls}`}>
                  {src.label}
                </span>
                <span className="whitespace-nowrap rounded-full surface-2 px-2.5 py-1 text-xs font-bold">
                  <span className="tnum">{num(e.count)}</span> {e.count === 1 ? 'مرة' : 'مرات'}
                </span>
                <span className="ms-auto whitespace-nowrap text-xs text-muted">{dateTime(e.lastAt)}</span>
              </div>

              <pre
                dir="ltr"
                className="surface-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-start font-mono text-[12.5px] leading-relaxed [overflow-wrap:anywhere]"
              >
                {e.message}
              </pre>

              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">آخر صفحة</dt>
                <dd className="min-w-0 break-all">
                  <span dir="ltr" className="font-mono">
                    {e.lastPath ?? '—'}
                  </span>
                </dd>
                <dt className="text-muted">الجهاز</dt>
                <dd className="min-w-0 break-words">
                  <span dir="ltr">{device ?? '—'}</span>
                </dd>
              </dl>

              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={() => details(e)} label="نسخ التفاصيل" />
                {e.stack && (
                  <details className="min-w-0 flex-1 basis-full text-xs">
                    <summary className="cursor-pointer select-none font-semibold text-muted">
                      تفاصيل تقنية
                    </summary>
                    <pre
                      dir="ltr"
                      className="surface-2 mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-start font-mono text-[11.5px] leading-relaxed [overflow-wrap:anywhere]"
                    >
                      {e.stack}
                    </pre>
                  </details>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
