'use client';

import { useSyncExternalStore } from 'react';
import { COUNTRIES } from './countries';

/**
 * Countries with their own payment methods and prices, as the owner set them
 * out; every other country pays in dollars. The order of `currencies` is the
 * default first.
 */
export const REGIONS = [
  { id: 'MR', currencies: ['MRU'] },
  { id: 'ML', currencies: ['XOF', 'USD'] },
  { id: 'DZ', currencies: ['DZD', 'USD'] },
  { id: 'NE', currencies: ['XOF', 'USD'] },
  { id: 'XX', currencies: ['USD'] },
] as const;

/** "Every other country", as payment methods and the dashboard spell it. */
export const OTHER_REGION = 'XX';
export const DEFAULT_REGION = 'MR';

export const REGION_LABEL: Record<string, string> = {
  MR: 'موريتانيا',
  ML: 'مالي',
  DZ: 'الجزائر',
  NE: 'النيجر',
  XX: 'دولة أخرى',
};

export function currenciesFor(region: string): readonly string[] {
  return (REGIONS.find((r) => r.id === region) ?? REGIONS[REGIONS.length - 1]).currencies;
}

/** The region a country belongs to: itself when it has its own methods, else "other". */
export function regionOf(iso: string | null | undefined): string {
  if (!iso) return DEFAULT_REGION;
  return REGIONS.some((r) => r.id === iso) ? iso : OTHER_REGION;
}

/** "+22231234567" → "MR", by the longest matching dialling code. */
export function countryOfPhone(e164: string | null | undefined): string | null {
  const digits = e164?.replace(/\D/g, '');
  if (!digits) return null;
  let best: { iso: string; dial: string } | null = null;
  for (const c of COUNTRIES) {
    if (digits.startsWith(c.dial) && (!best || c.dial.length > best.dial.length)) best = c;
  }
  // +1 is shared by the US, Canada and the Caribbean; any of them is "other"
  return best?.iso ?? null;
}

/** A payment method is offered where its countries say, or everywhere when it lists none. */
export function servesRegion(countries: string[] | undefined, region: string): boolean {
  return !countries?.length || countries.includes(region);
}

// ─── the customer's region: chosen by them, else from their WhatsApp number ───

const KEY = 'patron_region';
const listeners = new Set<() => void>();
let chosen: string | null | undefined;

function readChosen(): string | null {
  if (chosen === undefined) {
    try {
      const saved = localStorage.getItem(KEY);
      chosen = REGIONS.some((r) => r.id === saved) ? saved : null;
    } catch {
      chosen = null;
    }
  }
  return chosen;
}

export function setRegion(region: string) {
  chosen = region;
  try {
    localStorage.setItem(KEY, region);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** The region to price and pay in, given the signed-in customer's phone (if any). */
export function useRegion(phone: string | null | undefined): string {
  const picked = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readChosen,
    () => null,
  );
  return picked ?? regionOf(countryOfPhone(phone));
}
