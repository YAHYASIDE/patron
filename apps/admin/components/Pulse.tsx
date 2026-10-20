'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, isNotReady } from '@/lib/api';

/** What the dashboard polls every 20 s (GET /admin/insights/pulse). */
export type Pulse = {
  latestOrderId: string | null;
  latestOrderNumber: string | null;
  latestOrderAt: string | null;
  pendingTransfers: number;
  pendingVerifications: number;
  openTickets: number;
};
export type PulseEvent = { title: string; body: string; href: string };

const POLL_MS = 20_000;
const SOUND_KEY = 'patron.sound';

// Browsers only let a page make sound after the owner touched it once.
let audio: AudioContext | null = null;
function unlockAudio() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    /* no audio on this device */
  }
}

/** Two short rising tones, made on the spot (no sound file). */
export function beep() {
  if (!audio || audio.state !== 'running') return;
  const now = audio.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    const t = now + i * 0.16;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  });
}

export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}
function setSoundPref(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* private window */
  }
}

/** What changed between two polls that the owner should hear about. */
function diff(prev: Pulse, next: Pulse): PulseEvent | null {
  if (next.latestOrderId && next.latestOrderId !== prev.latestOrderId) {
    return {
      title: 'طلب جديد',
      body: next.latestOrderNumber ? `وصل الطلب ${next.latestOrderNumber}` : 'وصل طلب جديد إلى المتجر',
      href: `/orders/${next.latestOrderId}`,
    };
  }
  if (next.pendingTransfers > prev.pendingTransfers) {
    return {
      title: 'تحويل بانتظار تأكيدك',
      body: 'أرسل زبون إيصال تحويل، تحقّق منه ثم أكّد الدفع.',
      href: '/orders',
    };
  }
  return null;
}

/**
 * Polls the pulse while the dashboard is open. On a new order (or a new
 * transfer to check) it calls onEvent once. Older servers without the pulse
 * route still get the codes badge from the verifications list.
 */
export function usePulse(enabled: boolean, onEvent: (e: PulseEvent) => void): Pulse | null {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const prev = useRef<Pulse | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let fallback = false;
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    const poll = async () => {
      try {
        if (fallback) {
          const codes = await api.get<unknown[]>('/admin/verifications/pending');
          if (alive)
            setPulse({
              latestOrderId: null,
              latestOrderNumber: null,
              latestOrderAt: null,
              pendingTransfers: 0,
              pendingVerifications: codes.length,
              openTickets: 0,
            });
          return;
        }
        const next = await api.get<Pulse>('/admin/insights/pulse');
        if (!alive) return;
        // the first answer is the baseline, not news
        const ev = prev.current ? diff(prev.current, next) : null;
        prev.current = next;
        setPulse(next);
        if (ev) handler.current(ev);
      } catch (e) {
        if (isNotReady(e) && !fallback) {
          fallback = true;
          void poll();
        }
      }
    };
    void poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [enabled]);

  return pulse;
}

/** Browser notification, when the owner allowed it and is looking at another tab or app. */
export function systemNotify(ev: PulseEvent, open: (href: string) => void) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible' && document.hasFocus()) return; // the toast is enough
    const n = new Notification(ev.title, { body: ev.body, tag: 'patron-pulse', lang: 'ar', dir: 'rtl' });
    n.onclick = () => {
      window.focus();
      open(ev.href);
      n.close();
    };
  } catch {
    /* some phones only allow notifications from a service worker */
  }
}

/** Header button: turns on browser notifications (asked on click, never on load) and the sound. */
export function AlertsButton() {
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [sound, setSound] = useState(true);

  useEffect(() => {
    setPerm('Notification' in window ? Notification.permission : 'unsupported');
    setSound(soundOn());
  }, []);

  async function click() {
    unlockAudio();
    if (perm === 'default') {
      const p = await Notification.requestPermission().catch(() => 'denied' as const);
      setPerm(p);
      setSoundPref(true);
      setSound(true);
      beep();
      return;
    }
    const next = !sound;
    setSoundPref(next);
    setSound(next);
    if (next) beep();
  }

  const asking = perm === 'default';
  const label = asking ? 'فعّل التنبيهات' : sound ? 'صوت الطلبات مفعّل' : 'صوت الطلبات مكتوم';
  return (
    <button
      onClick={click}
      title={label}
      aria-label={label}
      className={
        'flex h-9 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold transition ' +
        (asking ? 'bg-teal text-white' : sound ? 'bg-teal/12 text-teal' : 'surface-2 text-muted')
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
        <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
        {!asking && !sound && <path d="M3 3l18 18" />}
      </svg>
      {asking && <span className="hidden sm:inline">{label}</span>}
    </button>
  );
}

/** A short message at the bottom of the screen; tap to open what it is about. */
export function Toast({ ev, onClose }: { ev: PulseEvent; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [ev, onClose]);

  return (
    <div
      role="status"
      className="surface fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-2xl p-3.5 shadow-float sm:inset-x-auto sm:end-4 sm:w-96"
    >
      <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal/12 text-teal">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      </span>
      <Link href={ev.href} onClick={onClose} className="min-w-0 flex-1">
        <div className="text-sm font-extrabold">{ev.title}</div>
        <div className="truncate text-xs text-muted">{ev.body}</div>
      </Link>
      <button
        onClick={onClose}
        aria-label="إغلاق"
        className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:text-[rgb(var(--text))]"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
