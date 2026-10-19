'use client';

import { useSyncExternalStore } from 'react';
import { catalog } from './api';
import { cart } from './cart';
import { isGone, removeProduct } from './cart-check';

/** Display currencies the shop offers; prices come from the API in the chosen one. */
export const CURRENCIES = [
  { code: 'MRU', label: 'أوقية' },
  { code: 'USD', label: 'دولار' },
  { code: 'XOF', label: 'فرنك' },
  { code: 'DZD', label: 'دينار' },
] as const;

/** Mauritania first: ouguiya unless the customer picks another. */
export const DEFAULT_CURRENCY = 'MRU';

const KEY = 'patron_currency';
const listeners = new Set<() => void>();
let current: string | null = null;

function read(): string {
  if (current === null) {
    try {
      const saved = localStorage.getItem(KEY);
      current = CURRENCIES.some((c) => c.code === saved) ? (saved as string) : DEFAULT_CURRENCY;
    } catch {
      current = DEFAULT_CURRENCY;
    }
  }
  return current;
}

export function getCurrency(): string {
  return typeof window === 'undefined' ? DEFAULT_CURRENCY : read();
}

/** Switch the shop currency and re-price what is already in the cart. */
export async function setCurrency(code: string) {
  current = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
  await repriceCart(code);
}

/** Cart lines keep the price they were added at; bring them to `code` so the total adds up. */
export async function repriceCart(code: string) {
  const stale = cart.items().filter((i) => i.currency !== code);
  if (stale.length === 0) return;
  const ids = [...new Set(stale.map((i) => i.productId))];
  const fresh = await Promise.all(
    ids.map((id) =>
      catalog.product(id, code).catch((err) => {
        // a product the shop no longer sells would otherwise stay priced in the old currency
        if (isGone(err)) removeProduct(id);
        return null;
      }),
    ),
  );
  const byId = new Map(fresh.filter((p) => p !== null).map((p) => [p.id, p]));
  cart.reprice((i) => {
    const p = byId.get(i.productId);
    return p && p.currency === code ? { unitPrice: String(p.sellPrice), currency: p.currency } : null;
  });
}

export function useCurrency(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => DEFAULT_CURRENCY,
  );
}
