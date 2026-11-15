'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isAuthed, me } from './api';

/**
 * The customer's favourite brands (brand keys, newest first), shared by every
 * heart in the shop so a tile and the brand page never disagree. Signed in,
 * the list lives on the account (GET/PUT/DELETE /me/favorites) and is loaded
 * once; a guest's hearts stay in this browser and join the account the first
 * time they sign in.
 */
const KEY = 'patron_favorites';
const EMPTY: string[] = [];
const listeners = new Set<() => void>();

type State = { mode: 'account' | 'guest'; keys: string[]; ready: boolean };
let state: State | null = null;

const emit = () => listeners.forEach((l) => l());
const modeNow = (): State['mode'] => (isAuthed() ? 'account' : 'guest');

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function writeLocal(keys: string[]) {
  try {
    if (keys.length) localStorage.setItem(KEY, JSON.stringify(keys));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: the hearts last for this visit */
  }
}

/** Load the list for whoever is browsing now (again after signing in or out). */
function ensure() {
  const mode = modeNow();
  if (state?.mode === mode) return;
  if (mode === 'guest') {
    state = { mode, keys: readLocal(), ready: true };
    emit();
    return;
  }
  const mine: State = { mode, keys: EMPTY, ready: false };
  state = mine;
  emit();
  me.favorites()
    .then(async (keys) => {
      const local = readLocal().filter((k) => !keys.includes(k));
      if (local.length) {
        await Promise.all(local.map((k) => me.addFavorite(k).catch(() => undefined)));
        writeLocal([]);
      }
      if (state === mine) {
        state = { mode, keys: [...local, ...keys], ready: true };
        emit();
      }
    })
    .catch(() => {
      if (state === mine) {
        state = { ...mine, ready: true };
        emit();
      }
    });
}

function set(keys: string[]) {
  if (!state) return;
  state = { ...state, keys };
  if (state.mode === 'guest') writeLocal(keys);
  emit();
}

/** Add or remove a brand; the heart changes at once and goes back if the account refuses. */
export async function toggleFavorite(brandKey: string): Promise<boolean> {
  ensure();
  const before = state?.keys ?? EMPTY;
  const on = !before.includes(brandKey);
  set(on ? [brandKey, ...before] : before.filter((k) => k !== brandKey));
  if (state?.mode === 'account') {
    try {
      await (on ? me.addFavorite(brandKey) : me.removeFavorite(brandKey));
    } catch {
      set(before);
      return !on;
    }
  }
  return on;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The favourite brand keys, newest first (empty while loading and on the server). */
export function useFavorites(): string[] {
  useEffect(ensure, []);
  return useSyncExternalStore(
    subscribe,
    () => state?.keys ?? EMPTY,
    () => EMPTY,
  );
}

/** False until the account's list has arrived (a favourites page shows a skeleton meanwhile). */
export function useFavoritesReady(): boolean {
  useEffect(ensure, []);
  return useSyncExternalStore(
    subscribe,
    () => state?.ready ?? false,
    () => false,
  );
}
