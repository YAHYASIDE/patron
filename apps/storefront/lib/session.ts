'use client';

import { useEffect, useState } from 'react';
import { auth, isAuthed } from './api';
import type { Me } from './types';

/**
 * The signed-in customer, shared by the header badge, checkout and account
 * page. One request per change: call refreshMe() after sign-in or verification.
 */
const EVENT = 'patron-me-changed';
let cached: Promise<Me | null> | null = null;

function load(): Promise<Me | null> {
  if (!isAuthed()) return Promise.resolve(null);
  if (!cached) {
    cached = auth.me().catch(() => null);
    cached.then((me) => me === null && (cached = null)); // a failed load is retried next time
  }
  return cached;
}

export function refreshMe() {
  cached = null;
  window.dispatchEvent(new Event(EVENT));
}

export function useMe(): { me: Me | null; loading: boolean } {
  const [state, setState] = useState<{ me: Me | null; loading: boolean }>({ me: null, loading: true });

  useEffect(() => {
    let alive = true;
    const run = () => load().then((me) => alive && setState({ me, loading: false }));
    run();
    window.addEventListener(EVENT, run);
    return () => {
      alive = false;
      window.removeEventListener(EVENT, run);
    };
  }, []);

  return state;
}
