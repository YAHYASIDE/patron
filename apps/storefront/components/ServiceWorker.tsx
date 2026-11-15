'use client';

import { useEffect } from 'react';

/**
 * Registers public/sw.js (app shell + offline page) in production builds.
 * The dev server's scripts change under the same names, so a worker there
 * would serve stale code: in development it is removed instead, unless
 * localStorage "patron_sw" is "1" (to try the offline page locally).
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let wanted = process.env.NODE_ENV === 'production';
    try {
      wanted ||= localStorage.getItem('patron_sw') === '1';
    } catch {
      /* ignore */
    }
    if (wanted) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    } else {
      navigator.serviceWorker
        .getRegistrations()
        .then((list) => list.forEach((r) => r.unregister()))
        .catch(() => undefined);
    }
  }, []);
  return null;
}
