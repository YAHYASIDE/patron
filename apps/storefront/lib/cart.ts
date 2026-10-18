'use client';

/** A tiny localStorage-backed cart store with a cached snapshot + subscribe API. */

export type CartInput = { key: string; value: string };

export type CartItem = {
  productId: string;
  sku: string;
  nameAr: string;
  imageUrl?: string | null;
  unitPrice: string; // in `currency`
  currency: string;
  quantity: number;
  gameId?: string | null;
  delivery?: string;
  maxPerOrder?: number | null;
  inputs?: CartInput[];
};

const KEY = 'patron_cart';
const listeners = new Set<() => void>();

// Cached snapshot: a STABLE reference so useSyncExternalStore does not loop.
// Replaced wholesale on every mutation.
let state: CartItem[] | null = null;

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

function snapshot(): CartItem[] {
  if (state === null) state = load();
  return state;
}

function commit(items: CartItem[]) {
  state = items;
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

// A line is unique by product + its inputs (e.g. a specific player ID), so the
// same product with different inputs stays separate.
function lineKey(item: Pick<CartItem, 'productId' | 'inputs'>): string {
  const inputs = (item.inputs ?? [])
    .map((i) => `${i.key}=${i.value}`)
    .sort()
    .join('&');
  return `${item.productId}|${inputs}`;
}

export const cart = {
  items: snapshot,
  count(): number {
    return snapshot().reduce((n, i) => n + i.quantity, 0);
  },
  total(): { amount: number; currency: string } {
    const items = snapshot();
    const amount = items.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0);
    return { amount, currency: items[0]?.currency ?? 'USD' };
  },
  add(item: CartItem) {
    const items = snapshot().slice();
    const key = lineKey(item);
    const idx = items.findIndex((i) => lineKey(i) === key);
    const cap = item.maxPerOrder ?? Infinity;
    if (idx >= 0) {
      items[idx] = { ...items[idx], quantity: Math.min(items[idx].quantity + item.quantity, cap) };
    } else {
      items.push({ ...item, quantity: Math.min(item.quantity, cap) });
    }
    commit(items);
  },
  setQuantity(key: string, quantity: number) {
    const items = snapshot().map((i) => {
      if (lineKey(i) !== key) return i;
      const cap = i.maxPerOrder ?? Infinity;
      return { ...i, quantity: Math.max(1, Math.min(quantity, cap)) };
    });
    commit(items);
  },
  remove(key: string) {
    commit(snapshot().filter((i) => lineKey(i) !== key));
  },
  clear() {
    commit([]);
  },
  keyOf: lineKey,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
