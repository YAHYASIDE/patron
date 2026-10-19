'use client';

import { useLang, useT, type Lang } from '@/lib/i18n';
import type { Localized, ProductGuide } from '@/lib/types';
import { ShieldIcon } from './icons';

/** The text in the page's language, falling back to Arabic. */
export function pick(text: Localized | undefined, lang: Lang): string {
  if (!text) return '';
  return (lang === 'fr' ? text.fr : lang === 'en' ? text.en : text.ar) || text.ar;
}

/** A product's guide from its metadata, if it has one. */
export function guideOf(metadata: Record<string, unknown> | null | undefined): ProductGuide | null {
  const g = metadata?.guide;
  return g && typeof g === 'object' ? (g as ProductGuide) : null;
}

/**
 * Numbered steps for the customer: what to do before paying, or how to use
 * what they received. The warning (the costly mistake) stands out above them.
 */
export default function Guide({
  title,
  steps,
  warning,
  tone = 'teal',
}: {
  title: string;
  steps?: Localized[];
  warning?: Localized;
  tone?: 'teal' | 'ok';
}) {
  const lang = useLang();
  const t = useT();
  if (!steps?.length && !warning) return null;
  return (
    <div className={`rounded-2xl border p-4 ${tone === 'ok' ? 'border-ok/25 bg-ok/5' : 'border-teal/20 bg-teal/5'}`}>
      <div className="text-sm font-extrabold">{t(title)}</div>
      {warning && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-xs font-semibold leading-relaxed text-warn">
          <ShieldIcon size={14} className="mt-0.5 flex-none" />
          {pick(warning, lang)}
        </p>
      )}
      {!!steps?.length && (
        <ol className="mt-2.5 space-y-1.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
              <span className="tnum grid h-5 w-5 flex-none place-items-center rounded-full bg-teal text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <span>{pick(s, lang)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
