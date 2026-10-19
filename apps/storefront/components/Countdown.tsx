'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { ClockIcon } from './discovery-icons';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Time left on an offer, ticking each second: "2 days 5 h" while it is far,
 * "05:12:33" on its last day. Calls `onEnd` once at zero. Renders nothing
 * before mount (the server does not know the visitor's clock).
 */
export default function Countdown({ endsAt, onEnd, className = '' }: { endsAt: string; onEnd?: () => void; className?: string }) {
  const t = useT();
  const end = Date.parse(endsAt);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const left = now === null || !isFinite(end) ? null : Math.max(0, Math.floor((end - now) / 1000));
  useEffect(() => {
    if (left === 0) onEnd?.();
  }, [left, onEnd]);

  if (left === null || left <= 0) return null;
  const d = Math.floor(left / 86400);
  const h = Math.floor((left % 86400) / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm ${className}`}
      role="timer"
      aria-live="off"
    >
      <ClockIcon size={13} />
      {d > 0 ? (
        t('ينتهي خلال {d} يوم و{h} ساعة', { d, h })
      ) : (
        <>
          {t('ينتهي خلال')}{' '}
          <span dir="ltr" className="tnum">
            {pad(h)}:{pad(m)}:{pad(s)}
          </span>
        </>
      )}
    </span>
  );
}
