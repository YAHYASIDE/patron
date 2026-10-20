'use client';

import { useSyncExternalStore } from 'react';

/** Brands the visitor opened lately (brand keys, newest first), kept in this browser. */
const KEY = 'patron_recent';
const MAX = 8;
const EMPTY: string[] = [];
const listeners = new Set<() => void>();
let cached: string[] | null = null;

function read(): string[] {
  if (cached === null) {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
      cached = Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string').slice(0, MAX) : EMPTY;
    } catch {
      cached = EMPTY;
    }
  }
  return cached;
}

/** Remember a brand page visit (moves it to the front). */
export function pushRecent(brandKey: string) {
  const next = [brandKey, ...read().filter((k) => k !== brandKey)].slice(0, MAX);
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: remembered for this visit only */
  }
  listeners.forEach((l) => l());
}

export function useRecent(): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => EMPTY,
  );
}
