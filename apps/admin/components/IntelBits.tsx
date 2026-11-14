'use client';

import { useEffect, useId, useRef } from 'react';
import { date } from '@/lib/format';
import { isStale, safeUrl, STALE_DAYS, type Source } from '@/lib/intelligence';

/** Small building blocks shared by the intelligence center and the markets pages. */

export function Chip({ label, cls, title }: { label: string; cls: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex flex-none items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>
      {label}
    </span>
  );
}

/** A 0–100 bar with the number beside it. */
export function Confidence({ value, title = 'مدى ثقة البحث' }: { value: number; title?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const color = v >= 70 ? 'bg-ok' : v >= 40 ? 'bg-warn' : 'bg-bad';
  return (
    <span className="inline-flex items-center gap-2" title={title}>
      <span className="surface-2 h-1.5 w-16 overflow-hidden rounded-full" aria-hidden>
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(4, v)}%` }} />
      </span>
      <span className="tnum text-xs font-bold text-muted">{v}%</span>
    </span>
  );
}

/** "مؤكد" for a reproduced finding, "تقدير غير مؤكد" for a hypothesis. */
export function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Chip label="مؤكد" cls="bg-ok/12 text-ok" title="أُعيد إنتاجه أو تأكّد بالدليل" />
  ) : (
    <Chip label="تقدير غير مؤكد" cls="border border-dashed border-warn/50 text-warn" title="فرضية تحتاج تحققًا" />
  );
}

/** Where a research fact came from: each link opens in a new tab, without passing our page along. */
export function SourceList({ sources }: { sources: Source[] | null | undefined }) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) return <p className="text-xs text-warn">لا مصادر مسجّلة: لا تعتمد هذه المعلومة قبل التحقق.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {list.map((s, i) => {
        const href = safeUrl(s.url);
        const title = s.title || s.url || 'مصدر';
        return (
          <li key={`${s.url ?? ''}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                dir="auto"
                className="min-w-0 break-words font-bold text-teal hover:underline"
              >
                {title} ↗
              </a>
            ) : (
              <span dir="auto" className="min-w-0 break-words font-bold">
                {title}
              </span>
            )}
            {s.publisher && (
              <span dir="auto" className="text-muted">
                {s.publisher}
              </span>
            )}
            {s.accessedAt && <span className="text-muted">اطُّلع عليه {date(s.accessedAt)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** «آخر تحقق» with a warning once it is older than the stale threshold. */
export function LastVerified({ at, by }: { at: string | null | undefined; by?: string | null }) {
  const stale = isStale(at);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-muted">آخر تحقق:</span>
      <span className="font-semibold">{date(at)}</span>
      {by && (
        <span className="text-muted" dir="auto">
          ({by})
        </span>
      )}
      {stale && <Chip label="يحتاج إعادة تحقق" cls="bg-warn/12 text-warn" title={`أقدم من ${STALE_DAYS} يومًا`} />}
    </span>
  );
}

/** Escape closes; the page behind does not scroll. */
function useModal(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);
}

/** A bottom sheet on phones, a side panel on desktop (like the products quick edit). */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  /** stays visible under the scrolling content (the main actions) */
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  useModal(onClose);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={id}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className={
          'surface absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl border-0 shadow-float md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:rounded-none md:border-s md:border-[rgb(var(--line))] ' +
          (wide ? 'md:w-[560px]' : 'md:w-[440px]')
        }
      >
        <div className="flex items-start justify-between gap-3 border-b border-[rgb(var(--line))] px-5 pb-3 pt-3 md:pt-4">
          <div className="min-w-0 flex-1">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[rgb(var(--line))] md:hidden" />
            <h2 id={id} className="text-base font-bold leading-snug">
              {title}
            </h2>
            {subtitle && <div className="mt-1">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 min-h-10 flex-none rounded-xl px-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))] md:mt-0"
          >
            إغلاق
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="border-t border-[rgb(var(--line))] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>
        )}
      </div>
    </div>
  );
}

/** A yes/no question before something that changes what customers see. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'teal',
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  tone?: 'teal' | 'bad';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  useModal(() => !busy && onCancel());
  return (
    <div className="fixed inset-0 z-[60] grid place-items-end p-3 sm:place-items-center" role="alertdialog" aria-modal="true" aria-labelledby={id}>
      <div className="absolute inset-0 bg-black/40" onClick={() => !busy && onCancel()} />
      <div className="surface relative w-full max-w-md rounded-2xl p-5 shadow-float">
        <h2 id={id} className="text-base font-bold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{body}</div>
        {error && <p className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-sm font-semibold text-bad">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-11 rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold disabled:opacity-50"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={
              'min-h-11 rounded-xl px-5 text-sm font-bold text-white disabled:opacity-60 ' +
              (tone === 'bad' ? 'bg-bad hover:opacity-90' : 'bg-teal hover:bg-teal-deep')
            }
          >
            {busy ? 'جارٍ…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A dashed box for "nothing here". */
export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

/** Grey placeholder blocks while a list loads (keeps the layout from jumping). */
export function Skeleton({ rows = 3, h = 'h-20' }: { rows?: number; h?: string }) {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`surface-2 ${h} animate-pulse rounded-2xl motion-reduce:animate-none`} />
      ))}
    </div>
  );
}
