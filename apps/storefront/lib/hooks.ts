'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { ApiError } from './api';
import { cart, type CartItem } from './cart';

/** Client-side data fetching with loading/error, and a manual reload. */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'حدث خطأ غير متوقّع.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

/** Subscribe to the cart store; re-renders on any change. */
export function useCart(): { items: CartItem[]; count: number; total: { amount: number; currency: string } } {
  const items = useSyncExternalStore(
    cart.subscribe,
    () => cart.items(),
    () => [] as CartItem[],
  );
  return {
    items,
    count: items.reduce((n, i) => n + i.quantity, 0),
    total: {
      amount: items.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0),
      currency: items[0]?.currency ?? 'USD',
    },
  };
}
