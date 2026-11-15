'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isAuthed } from '@/lib/api';
import { report } from '@/lib/events';
import { tNow, useT } from '@/lib/i18n';
import { CheckIcon, CloseIcon } from './icons';

const MIN = 3;
const MAX = 300;
const MAX_CONTACT = 60;

/**
 * "Suggest a product": the customer tells the owner what the shop should add
 * (`suggestion` event). Guests may leave a phone number or name so the owner
 * can answer. A bottom sheet on phones, a dialog on wider screens.
 */
export function SuggestSheet({ initial = '', onClose }: { initial?: string; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState(initial.trim().slice(0, MAX));
  const [contact, setContact] = useState('');
  const [guest] = useState(() => !isAuthed());
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (value.length < MIN) return setError(tNow('اكتب {n} أحرف على الأقل.', { n: MIN }));
    const who = guest ? contact.trim() : '';
    report('suggestion', value, who ? { detail: { contact: who } } : undefined);
    setSent(true);
  }

  // in a portal: the opener may sit in centred, muted text (the "no results" box, the footer)
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="suggest-title"
        onClick={(e) => e.stopPropagation()}
        className="surface max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl p-5 shadow-float sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="suggest-title" className="pt-1.5 text-base font-extrabold">
            {t('اقترح منتجًا')}
          </h2>
          <button
            onClick={onClose}
            aria-label={t('إغلاق')}
            className="-me-1 grid h-9 w-9 flex-none place-items-center rounded-xl text-muted hover:bg-[rgb(var(--surface-2))]"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        {sent ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ok/12 text-ok">
              <CheckIcon size={24} />
            </span>
            <p className="font-bold">{t('شكرًا لك!')}</p>
            <p className="text-sm leading-relaxed text-muted">
              {t('وصل اقتراحك إلى المتجر، وسنحاول توفيره قريبًا.')}
            </p>
            <button onClick={onClose} className="btn-brand mt-3 rounded-xl px-6 py-2.5 text-sm font-bold">
              {t('إغلاق')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="mt-1 space-y-3">
            <p className="text-sm leading-relaxed text-muted">
              {t('أخبرنا بما تريد أن نضيفه إلى المتجر، وسنحاول توفيره.')}
            </p>
            <label className="block">
              <span className="text-sm font-bold">{t('ما المنتج الذي تبحث عنه؟')}</span>
              <textarea
                ref={box}
                value={text}
                onChange={(e) => {
                  setText(e.target.value.slice(0, MAX));
                  setError(null);
                }}
                rows={3}
                dir="auto"
                required
                minLength={MIN}
                maxLength={MAX}
                placeholder={t('مثال: بطاقة بلايستيشن 20 دولار')}
                className="surface-2 hairline mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
              />
              <span className="mt-0.5 block text-end text-[11px] text-muted tnum">
                {text.length}/{MAX}
              </span>
            </label>
            {guest && (
              <label className="block">
                <span className="text-sm font-bold">{t('رقم هاتفك أو اسمك (اختياري)')}</span>
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value.slice(0, MAX_CONTACT))}
                  maxLength={MAX_CONTACT}
                  dir="auto"
                  autoComplete="tel"
                  className="surface-2 hairline mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
                />
                <span className="mt-1 block text-xs text-muted">{t('لنخبرك حين يتوفّر.')}</span>
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            )}
            <button type="submit" className="btn-brand w-full rounded-xl py-3 text-[15px] font-bold">
              {t('أرسل الاقتراح')}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** A button that opens the sheet (`text` prefills it, e.g. with the search that found nothing). */
export default function SuggestButton({
  text,
  className,
  children,
}: {
  text?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {children}
      </button>
      {open && <SuggestSheet initial={text} onClose={close} />}
    </>
  );
}
