'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, isNotReady } from '@/lib/api';
import { beep, soundOn, systemNotify } from '@/components/Pulse';
import {
  INBOX_CHANGED,
  ago,
  getInbox,
  inboxChanged,
  markAllRead,
  markRead,
  priorityOf,
  safeLink,
  typeLabel,
  type Inbox,
  type StaffNotice,
} from '@/lib/staff-notifications';

const POLL_MS = 60_000;
const SHOWN = 8;

/**
 * Something that should ring: an URGENT or HIGH notice that is unread and new
 * since the last poll, or that came back as a reminder. Order and transfer
 * news already ring through the pulse (AlertsButton), so they only ring here
 * when they are reminders — one sound per event, not two.
 */
function ringFor(prev: Map<string, number>, next: StaffNotice[]): StaffNotice | null {
  for (const n of next) {
    if (n.readAt || (n.priority !== 'URGENT' && n.priority !== 'HIGH')) continue;
    const seen = prev.get(n.id);
    const pulseCovers = n.type === 'order.new' || n.type === 'payment.pending';
    if (seen === undefined ? !pulseCovers || n.remindCount > 0 : n.remindCount > seen) return n;
  }
  return null;
}

/** Header bell: unread count, the latest open notices, a link to the notification center. */
export default function StaffBell() {
  const router = useRouter();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const seen = useRef<Map<string, number> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await getInbox('open', 30);
      const prev = seen.current;
      // the first answer is the baseline, not news
      const ring = prev ? ringFor(prev, next.data) : null;
      seen.current = new Map(next.data.map((n) => [n.id, n.remindCount]));
      setInbox(next);
      if (ring) {
        if (soundOn()) beep();
        const href = safeLink(ring.link) ?? '/notifications';
        systemNotify({ title: ring.title, body: ring.body, href }, (h) => router.push(h));
      }
    } catch (e) {
      // no permission, or a server without the notification center: no bell
      if ((e instanceof ApiError && e.status === 403) || isNotReady(e)) setHidden(true);
    }
  }, [router]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    const onChange = () => void load();
    window.addEventListener(INBOX_CHANGED, onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener(INBOX_CHANGED, onChange);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (hidden) return null;

  const unread = inbox?.unread ?? 0;
  const urgent = inbox?.data.some((n) => !n.readAt && n.priority === 'URGENT') ?? false;
  const latest = inbox?.data.slice(0, SHOWN) ?? [];

  async function openNotice(n: StaffNotice) {
    setOpen(false);
    if (!n.readAt) {
      try {
        await markRead(n.id);
      } catch {
        /* reading it is enough; the next poll catches up */
      }
      inboxChanged();
    }
    router.push(safeLink(n.link) ?? '/notifications');
  }

  async function readAll() {
    try {
      await markAllRead();
    } finally {
      inboxChanged();
    }
  }

  const label = unread > 0 ? `الإشعارات: ${unread} غير مقروء` : 'الإشعارات';
  return (
    <div ref={box} className="relative flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        title={label}
        aria-expanded={open}
        className={
          'relative grid h-9 w-9 place-items-center rounded-full transition ' +
          (open ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
        }
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M5 4h14l2 9v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6l2-9Z" />
          <path d="M3 13h5l1.5 2.5h5L16 13h5" />
        </svg>
        {unread > 0 && (
          <span
            className={
              'absolute -end-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold text-white tnum ' +
              (urgent ? 'bg-bad' : 'bg-warn')
            }
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="آخر الإشعارات"
          className="surface fixed inset-x-3 top-[4.25rem] z-50 flex max-h-[75dvh] flex-col overflow-hidden rounded-2xl shadow-float sm:absolute sm:inset-x-auto sm:end-0 sm:top-11 sm:w-96"
        >
          <div className="flex items-center gap-2 border-b border-[rgb(var(--line))] px-4 py-3">
            <div className="font-extrabold">الإشعارات</div>
            {inbox && (
              <span className="text-xs text-muted tnum">
                {inbox.open} مفتوح · {unread} غير مقروء
              </span>
            )}
            {unread > 0 && (
              <button onClick={readAll} className="ms-auto text-xs font-bold text-teal hover:underline">
                تعليم الكل كمقروء
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!inbox && <p className="px-4 py-6 text-center text-sm text-muted">جارٍ التحميل…</p>}
            {inbox && latest.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-muted">لا شيء ينتظرك الآن.</p>
            )}
            {latest.map((n) => {
              const p = priorityOf(n.priority);
              return (
                <button
                  key={n.id}
                  onClick={() => void openNotice(n)}
                  className={
                    'flex w-full items-start gap-3 border-b border-[rgb(var(--line))] px-4 py-3 text-start transition last:border-0 hover:bg-[rgb(var(--surface-2))] ' +
                    (n.readAt ? 'opacity-75' : '')
                  }
                >
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${p.dot}`}
                    aria-label={p.label}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className={`truncate text-sm ${n.readAt ? 'font-semibold' : 'font-extrabold'}`}>
                        {n.title}
                      </span>
                      {n.remindCount > 0 && (
                        <span className="flex-none rounded-full bg-warn/12 px-1.5 text-[10px] font-bold text-warn tnum">
                          تذكير {n.remindCount}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{n.body}</span>
                    <span className="mt-1 block text-[11px] text-muted">
                      {typeLabel(n.type)} · {ago(n.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="border-t border-[rgb(var(--line))] px-4 py-3 text-center text-sm font-bold text-teal hover:bg-[rgb(var(--surface-2))]"
          >
            مركز الإشعارات
          </Link>
        </div>
      )}
    </div>
  );
}
