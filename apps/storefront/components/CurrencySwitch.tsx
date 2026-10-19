'use client';

import { useEffect, useRef, useState } from 'react';
import { CURRENCIES, getCurrency, repriceCart, setCurrency, useCurrency } from '@/lib/currency';
import { LANGS, setLang, useLang, useT } from '@/lib/i18n';
import { useMe } from '@/lib/session';
import { REGIONS, REGION_LABEL, currenciesFor, setRegion, useRegion } from '@/lib/regions';

const FLAG: Record<string, string> = { MR: '🇲🇷', ML: '🇲🇱', DZ: '🇩🇿', NE: '🇳🇪', XX: '🌍' };
// the Arabic label is the dictionary key; it is translated where it is shown
const label = (code: string) => CURRENCIES.find((c) => c.code === code)?.label ?? code;

/**
 * The customer's country and currency. Each country has its own currencies
 * (Mauritania: ouguiya; Mali and Niger: franc or dollar; Algeria: dinar or
 * dollar; elsewhere: dollar). The country starts from the WhatsApp number.
 * The store's language is chosen here too.
 */
export default function CurrencySwitch() {
  const t = useT();
  const lang = useLang();
  const currency = useCurrency();
  const { me } = useMe();
  const region = useRegion(me?.phone);
  const allowed = currenciesFor(region);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // a cart filled before the switch existed (or in another currency) is brought in line once
  useEffect(() => {
    repriceCart(getCurrency()).catch(() => undefined);
  }, []);

  // a currency the country does not use gives way to the country's own
  useEffect(() => {
    if (!allowed.includes(currency)) setCurrency(allowed[0]).catch(() => undefined);
  }, [allowed, currency]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('البلد: {region}، العملة: {currency}', {
          region: t(REGION_LABEL[region]),
          currency: t(label(currency)),
        })}
        className="flex items-center gap-1.5 rounded-xl bg-[rgb(var(--surface-2))] px-3 py-2 text-xs font-bold"
      >
        <span aria-hidden>{FLAG[region]}</span>
        {t(label(currency))}
      </button>

      {open && (
        <div className="surface absolute end-0 top-full z-50 mt-2 w-60 rounded-2xl p-3 shadow-float">
          <div className="text-xs font-bold text-muted">{t('بلدك')}</div>
          <div className="mt-1.5 flex flex-col">
            {REGIONS.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                aria-pressed={r.id === region}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-start text-sm font-semibold ${
                  r.id === region ? 'bg-teal/10 text-teal' : 'hover:bg-[rgb(var(--surface-2))]'
                }`}
              >
                <span aria-hidden>{FLAG[r.id]}</span>
                {t(REGION_LABEL[r.id])}
              </button>
            ))}
          </div>
          {allowed.length > 1 && (
            <>
              <div className="mt-3 text-xs font-bold text-muted">{t('العملة')}</div>
              <div className="mt-1.5 flex gap-1.5">
                {allowed.map((c) => (
                  <button
                    key={c}
                    onClick={() => c !== currency && setCurrency(c).catch(() => undefined)}
                    aria-pressed={c === currency}
                    className={`flex-1 rounded-lg px-2 py-1.5 text-sm font-bold ${
                      c === currency ? 'bg-teal text-white' : 'surface-2 text-muted'
                    }`}
                  >
                    {t(label(c))}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3 text-xs font-bold text-muted">{t('اللغة')}</div>
          <div className="mt-1.5 flex gap-1.5">
            {/* each language in its own name */}
            {LANGS.map((l) => (
              <button
                key={l.id}
                lang={l.id}
                onClick={() => l.id !== lang && setLang(l.id)}
                aria-pressed={l.id === lang}
                className={`flex-1 rounded-lg px-1.5 py-1.5 text-xs font-bold ${
                  l.id === lang ? 'bg-teal text-white' : 'surface-2 text-muted'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
