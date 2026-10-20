'use client';

import { useEffect } from 'react';
import { ApiError, sendEvent } from '@/lib/api';

/*
 * Reports this dashboard's own browser errors to POST /events (kind client_error)
 * so the owner sees them on /errors. Fire-and-forget, at most 10 per page load,
 * and noise is dropped: browser extensions, ResizeObserver warnings, opaque
 * cross-origin "Script error.", and network failures (the API logs its own 5xx).
 */
const MAX_PER_LOAD = 10;
let sent = 0;
const seen = new Set<string>();

const NOISE = [
  /ResizeObserver loop/i,
  /^Script error\.?$/i,
  /Failed to fetch|NetworkError|Load failed|Network request failed|network error/i,
  /Loading (CSS )?chunk [\w-]+ failed|ChunkLoadError/i,
];
const EXTENSION = /(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//i;

function report(message: string, stack: string, source = '') {
  if (sent >= MAX_PER_LOAD) return;
  const value = (message || 'Unknown error').trim().slice(0, 300) || 'Unknown error';
  if (NOISE.some((re) => re.test(value))) return;
  if (EXTENSION.test(source) || EXTENSION.test(stack)) return;
  if (seen.has(value)) return;
  seen.add(value);
  sent++;
  const ua = navigator.userAgent.slice(0, 200);
  let trace = stack.slice(0, 1500);
  // the contract caps detail at 2000 characters of JSON (escaping makes it grow)
  while (trace && JSON.stringify({ app: 'admin', stack: trace, ua }).length > 2000)
    trace = trace.slice(0, -100);
  sendEvent({
    kind: 'client_error',
    value,
    path: location.pathname.slice(0, 200),
    detail: { app: 'admin', stack: trace, ua },
  });
}

function describe(reason: unknown): { message: string; stack: string } | null {
  // network trouble, aborted requests and server errors are not bugs in this page
  if (reason instanceof ApiError && (reason.status === 0 || reason.status >= 500)) return null;
  if (reason instanceof Error) {
    if (reason.name === 'AbortError') return null;
    return {
      message: `${reason.name && reason.name !== 'Error' ? `${reason.name}: ` : ''}${reason.message}`,
      stack: reason.stack ?? '',
    };
  }
  if (reason === undefined || reason === null) return { message: 'Unhandled rejection', stack: '' };
  try {
    return { message: typeof reason === 'string' ? reason : JSON.stringify(reason), stack: '' };
  } catch {
    return { message: String(reason), stack: '' };
  }
}

export default function ErrorReporter() {
  useEffect(() => {
    function onError(e: ErrorEvent) {
      const d =
        e.error !== undefined && e.error !== null ? describe(e.error) : { message: e.message, stack: '' };
      if (d) report(d.message || e.message, d.stack, e.filename ?? '');
    }
    function onRejection(e: PromiseRejectionEvent) {
      const d = describe(e.reason);
      if (d) report(d.message, d.stack);
    }
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
