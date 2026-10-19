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

// ─── the customer's country: chosen by them, else their account's, else their WhatsApp number's ───

const KEY = 'patron_country';
const LEGACY_KEY = 'patron_region'; // before any country could be chosen, only the five regions were
const OWNER_KEY = 'patron_country_owner';
const listeners = new Set<() => void>();
let chosen: string | null | undefined;

const known = (iso: string | null) => !!iso && (iso === OTHER_REGION || COUNTRIES.some((c) => c.iso === iso));

function readChosen(): string | null {
  if (chosen === undefined) {
    try {
      const saved = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
      chosen = known(saved) ? saved : null;
    } catch {
      chosen = null;
    }
  }
  return chosen;
}

/** Any country (ISO code), or "XX" for one the customer did not name. */
export function setCountry(iso: string) {
  chosen = iso;
  try {
    localStorage.setItem(KEY, iso);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

/** Picking a region (the payment page's list) keeps a named country that already belongs to it. */
export function setRegion(region: string) {
  if (regionOf(readChosen()) !== region) setCountry(region);
}

type Who = { id?: string; country?: string | null; phone?: string | null } | null | undefined;

/**
 * Right after someone signs up or signs in on this device, the shop moves to
 * their account's country (the server knows it from their WhatsApp number),
 * once per account; what they pick afterwards is kept.
 */
export function adoptAccountCountry(me: Who) {
  if (!me?.id) return;
  try {
    if (localStorage.getItem(OWNER_KEY) === me.id) return;
    localStorage.setItem(OWNER_KEY, me.id);
  } catch {
    return;
  }
  const iso = me.country ?? countryOfPhone(me.phone);
  if (iso && known(iso)) setCountry(iso);
}

/** The customer's country: ISO code, "XX" when they said "another country", null when unknown. */
export function useCountry(me: Who): string | null {
  const picked = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    readChosen,
    () => null,
  );
  return picked ?? me?.country ?? countryOfPhone(me?.phone) ?? null;
}

/** The region to price and pay in. */
export function useRegion(me: Who): string {
  return regionOf(useCountry(me));
}
