'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isAuthed, me } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { BellIcon } from './discovery-icons';

/** Pages that mark notifications read can fire this to update the badge at once. */
export const UNREAD_EVENT = 'patron-unread-changed';
const POLL_MS = 60_000;

/**
 * The header bell: the signed-in customer's unread count, refreshed on every
 * page change, when the tab comes back, and once a minute. Links to
 * /notifications. Hidden for guests; a failed count just shows no badge.
 */
export default function NotificationBell({ className = '' }: { className?: string }) {
  const t = useT();
  const pathname = usePathname();
  const [authed, setAuthed] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const on = isAuthed();
    setAuthed(on);
    if (!on) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      me.unreadCount()
        .then((r) => alive && setCount(Math.max(0, r.count ?? 0)))
        .catch(() => alive && setCount(0));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    window.addEventListener(UNREAD_EVENT, load);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
      window.removeEventListener(UNREAD_EVENT, load);
    };
  }, [pathname]);

  if (!authed) return null;
  const label = count > 0 ? t('الإشعارات ({n} غير مقروءة)', { n: count }) : t('الإشعارات');
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className={`relative grid place-items-center rounded-xl text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))] ${className}`}
    >
      <BellIcon size={20} />
      {count > 0 && (
        <span className="absolute -end-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#e5486b] px-1 text-[11px] font-bold text-white tnum">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
