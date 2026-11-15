'use client';

import { useState } from 'react';
import { useT, tNow } from '@/lib/i18n';
import { CheckIcon } from '@/components/icons';
import { WhatsAppMark } from '@/components/WhatsAppHelp';

export type Revealed = { resultType: string; value: string };

/** A short gift note with the code, in the customer's language, for WhatsApp's contact picker. */
export function giftLink(product: string, code: string): string {
  const text = [tNow('هدية لك 🎁'), product, tNow('الكود: {code}', { code })].join('\n');
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Revealed codes of one order item: each one copyable, and (a code, not a
 * message from the shop) sendable to a friend on WhatsApp as a gift (#24).
 */
export default function CodeList({ values, product }: { values: Revealed[]; product: string }) {
  const t = useT();
  const [copied, setCopied] = useState<number | null>(null);

  async function copy(i: number, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1800);
    } catch {
      /* no clipboard (http, old browser): the code stays selectable */
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {values.map((r, i) => {
        const message = r.resultType === 'message';
        return (
          <div key={i} className="surface-2 rounded-xl px-3 py-2.5">
            {/* a code reads left to right in a monospace face; a message from the shop is plain text */}
            <div
              dir={message ? undefined : 'ltr'}
              className={'select-all break-all text-[15px] font-bold ' + (message ? 'break-words' : 'font-mono')}
            >
              {r.value}
            </div>
            {!message && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={() => copy(i, r.value)}
                  className="surface inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-bold"
                >
                  {copied === i ? <CheckIcon size={14} className="text-ok" /> : null}
                  {copied === i ? t('تم النسخ') : t('نسخ')}
                </button>
                <a
                  href={giftLink(product, r.value)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#1FA855] px-3 py-1.5 text-xs font-bold text-white"
                >
                  <WhatsAppMark size={14} />
                  {t('أرسله لصديق')}
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
