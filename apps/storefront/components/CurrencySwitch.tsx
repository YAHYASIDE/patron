'use client';

import { useEffect } from 'react';
import { CURRENCIES, getCurrency, repriceCart, setCurrency, useCurrency } from '@/lib/currency';

/** Two-way toggle between the shop currencies (ouguiya / dollar). */
export default function CurrencySwitch() {
  const currency = useCurrency();

  // a cart filled before the switch existed (or in another currency) is brought in line once
  useEffect(() => {
    repriceCart(getCurrency()).catch(() => undefined);
  }, []);

  const other = CURRENCIES.find((c) => c.code !== currency) ?? CURRENCIES[0];
  const active = CURRENCIES.find((c) => c.code === currency) ?? CURRENCIES[0];

  return (
    <>
      {/* phones: one pill that flips to the other currency */}
      <button
        onClick={() => setCurrency(other.code).catch(() => undefined)}
        aria-label={`العملة: ${active.label}. التبديل إلى ${other.label}`}
        className="rounded-xl bg-[rgb(var(--surface-2))] px-3 py-2 text-xs font-bold sm:hidden"
      >
        {active.label} ⇄
      </button>
      <div
        role="group"
        aria-label="العملة"
        className="hidden rounded-xl bg-[rgb(var(--surface-2))] p-0.5 text-xs font-bold sm:flex"
      >
        {CURRENCIES.map((c) => (
          <button
            key={c.code}
            onClick={() => c.code !== currency && setCurrency(c.code).catch(() => undefined)}
            aria-pressed={c.code === currency}
            className={
              'rounded-lg px-2.5 py-1.5 transition ' +
              (c.code === currency
                ? 'bg-[rgb(var(--surface))] text-[rgb(var(--text))] shadow-sm'
                : 'text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {c.label}
          </button>
        ))}
      </div>
    </>
  );
}
