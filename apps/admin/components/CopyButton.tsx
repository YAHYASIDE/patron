'use client';

import { useEffect, useState } from 'react';

/** Put text on the clipboard; falls back to a hidden textarea where the Clipboard API is missing. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** A small "copy" button that says "نُسخ ✓" for a moment after a click. */
export default function CopyButton({
  text,
  label = 'نسخ',
  className = '',
}: {
  text: string | (() => string);
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      onClick={async () =>
        setState((await copyText(typeof text === 'function' ? text() : text)) ? 'done' : 'failed')
      }
      className={
        'flex-none whitespace-nowrap rounded-xl border px-3 py-1.5 text-xs font-bold transition ' +
        (state === 'done'
          ? 'border-ok/40 bg-ok/10 text-ok'
          : state === 'failed'
            ? 'border-bad/40 text-bad'
            : 'hairline text-muted hover:border-teal hover:text-[rgb(var(--text))]') +
        (className ? ` ${className}` : '')
      }
    >
      {state === 'done' ? 'نُسخ ✓' : state === 'failed' ? 'تعذّر النسخ' : label}
    </button>
  );
}
