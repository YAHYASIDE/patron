'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';
import BrandMark from './BrandMark';
import { CloseIcon } from './icons';
import { IosShareIcon } from './discovery-icons';

/** Chrome's install event, kept by INSTALL_INIT (lib/boot-scripts.ts) until this mounts. */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
declare global {
  interface Window {
    __patronInstall?: InstallEvent | null;
  }
}

const DISMISS_KEY = 'patron_install_dismissed';
const QUIET_DAYS = 30;

function dismissedLately(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    return Date.now() - at < QUIET_DAYS * 86_400_000;
  } catch {
    return true;
  }
}

function standalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// iPhone / iPad Safari (other iOS browsers cannot add to the home screen the same way)
function iosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios|opios/i.test(ua);
}

/**
 * "Install the app": on Android / desktop Chrome the browser's own install
 * dialog behind one button; on iPhone Safari, which has no such event, a
 * two-step how-to. Home page only, never inside the installed app, and quiet
 * for a month after "not now".
 */
export default function InstallPrompt() {
  const t = useT();
  const pathname = usePathname();
  const [mode, setMode] = useState<'android' | 'ios' | null>(null);

  useEffect(() => {
    if (standalone() || dismissedLately()) return;
    const ready = () => window.__patronInstall && setMode('android');
    ready();
    window.addEventListener('patron-installable', ready);
    const installed = () => setMode(null);
    window.addEventListener('appinstalled', installed);
    // give Safari visitors a moment with the page before suggesting it
    const ios = iosSafari() ? setTimeout(() => setMode((m) => m ?? 'ios'), 4000) : undefined;
    return () => {
      window.removeEventListener('patron-installable', ready);
      window.removeEventListener('appinstalled', installed);
      clearTimeout(ios);
    };
  }, []);

  if (!mode || pathname !== '/') return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
    setMode(null);
  }

  async function install() {
    const e = window.__patronInstall;
    if (!e) return;
    window.__patronInstall = null;
    await e.prompt().catch(() => undefined);
    const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice.outcome !== 'accepted') dismiss();
    else setMode(null);
  }

  return (
    // phones: beside the WhatsApp button, not under it; wider screens: the other bottom corner
    <div
      role="dialog"
      aria-label={t('ثبّت تطبيق باترون')}
      className="surface fixed bottom-5 start-4 end-[5.25rem] z-40 rounded-2xl p-3 shadow-float sm:end-auto sm:w-[22rem] lg:bottom-6 lg:start-6"
    >
      <div className="flex items-start gap-3">
        <BrandMark size={40} id="install" className="flex-none" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-extrabold">{t('ثبّت تطبيق باترون')}</div>
          {mode === 'android' ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {t('افتح المتجر من شاشتك الرئيسية بلمسة، حتى مع اتصال ضعيف.')}
            </p>
          ) : (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              {t('اضغط زر المشاركة')}{' '}
              <IosShareIcon size={14} className="inline-block align-[-2px] text-teal" />{' '}
              {t('ثم «إضافة إلى الشاشة الرئيسية».')}
            </p>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label={t('ليس الآن')}
          className="-me-1 -mt-1 grid h-8 w-8 flex-none place-items-center rounded-lg text-muted hover:bg-[rgb(var(--surface-2))]"
        >
          <CloseIcon size={16} />
        </button>
      </div>
      {mode === 'android' && (
        <div className="mt-2.5 flex gap-2">
          <button onClick={install} className="btn-brand flex-1 rounded-xl py-2 text-sm font-bold">
            {t('تثبيت')}
          </button>
          <button
            onClick={dismiss}
            className="rounded-xl px-3 py-2 text-sm font-bold text-muted hover:bg-[rgb(var(--surface-2))]"
          >
            {t('ليس الآن')}
          </button>
        </div>
      )}
    </div>
  );
}
