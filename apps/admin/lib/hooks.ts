'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from './api';

type State<T> = { data: T | null; error: string | null; loading: boolean };

/** Fetch a GET endpoint on mount; re-run with reload(). */
export function useFetch<T>(path: string | null): State<T> & { reload: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!path });

  const run = useCallback(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api
      .get<T>(path)
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: unknown) =>
        alive &&
        setState({
          data: null,
          loading: false,
          error: e instanceof ApiError ? e.message : 'تعذّر جلب البيانات',
        }),
      );
    return () => {
      alive = false;
    };
  }, [path]);

  useEffect(() => run(), [run]);

  return { ...state, reload: run };
}
