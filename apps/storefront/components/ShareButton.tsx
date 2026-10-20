'use client';

import { useEffect, useRef, useState } from 'react';
import { tNow, useT } from '@/lib/i18n';
import { CopyIcon, ShareIcon } from './discovery-icons';
import { WhatsAppMark } from './WhatsAppHelp';
import { CheckIcon } from './icons';

/**
 * Share a page: the phone's share sheet where there is one, else a small menu
 * with WhatsApp and "copy link".
 */
export default function ShareButton({ title, path }: { title: string; path: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const url = () => `${window.location.origin}${path}`;
  const text = () => tNow('{title} على patron', { title });

  async function onShare() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: text(), url: url() });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // the customer closed the sheet
      }
    }
    setOpen((v) => !v);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
    } catch {
      // older browsers: a hidden field
      const el = document.createElement('textarea');
      el.value = url();
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div ref={box} className="relative flex-none">
      <button
        type="button"
        onClick={onShare}
        aria-label={t('مشاركة')}
        title={t('مشاركة')}
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-xl border border-[rgb(var(--line))] text-muted transition hover:border-teal hover:text-teal"
      >
        <ShareIcon size={18} />
      </button>
      {open && (
        <div className="surface absolute end-0 top-full z-30 mt-2 w-52 rounded-2xl p-1.5 shadow-float">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${text()}\n${url()}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-[rgb(var(--surface-2))]"
          >
            <span className="text-[#1FA855]">
              <WhatsAppMark size={18} />
            </span>
            {t('واتساب')}
          </a>
          <button
            type="button"
            onClick={copy}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-start text-sm font-bold hover:bg-[rgb(var(--surface-2))]"
          >
            {copied ? <CheckIcon size={18} className="text-teal" /> : <CopyIcon size={18} className="text-muted" />}
            {copied ? t('نُسخ الرابط') : t('نسخ الرابط')}
          </button>
        </div>
      )}
    </div>
  );
}
