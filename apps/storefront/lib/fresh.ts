'use client';

import { useSyncExternalStore } from 'react';
import type { Brand } from './brands';
import type { Product } from './types';

/**
 * Facts the public product payload carries beyond lib/types' Product
 * (docs/api-contract-50.md): when it was added and how long delivery usually takes.
 */
export type ProductFacts = { createdAt?: string | null; etaMinutes?: number | null };
const facts = (p: Product) => p as Product & ProductFacts;

/** Minutes the owner says delivery usually takes, or null when not set. */
export function etaMinutes(p: Product): number | null {
  const v = facts(p).etaMinutes;
  return typeof v === 'number' && v > 0 ? v : null;
}

const NEW_DAYS = 14;

function isRecent(brand: Brand, now: number): boolean {
  const newest = Math.max(0, ...brand.products.map((p) => Date.parse(facts(p).createdAt ?? '') || 0));
  return newest > 0 && now - newest < NEW_DAYS * 86_400_000;
}

/*
 * "جديد" means newer than the rest. Right after a catalogue is loaded every
 * product is a few days old, and a badge on every tile says nothing, so when
 * most of the shop is recent no brand is marked. Pages that hold the whole
 * catalogue tell this store (noteCatalog); a tile shown elsewhere falls back
 * to the plain 14-day rule.
 */
let fresh: Set<string> | null = null;
const listeners = new Set<() => void>();

export function noteCatalog(brands: Brand[]) {
  if (brands.length === 0) return;
  const now = Date.now();
  const recent = brands.filter((b) => isRecent(b, now)).map((b) => b.key);
  const next = new Set(recent.length * 2 > brands.length ? [] : recent);
  if (fresh && fresh.size === next.size && [...next].every((k) => fresh!.has(k))) return;
  fresh = next;
  listeners.forEach((l) => l());
}

export function useIsNew(brand: Brand): boolean {
  const set = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => fresh,
    () => null,
  );
  return set ? set.has(brand.key) : isRecent(brand, Date.now());
}
