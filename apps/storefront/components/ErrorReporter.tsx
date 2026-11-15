'use client';

import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { report } from '@/lib/events';

// noise that is not the store's fault: cross-origin scripts without details, a
// harmless layout warning, and the network (the store shows its waking banner)
const NOISE =
  /^Script error\.?$|ResizeObserver loop|Failed to fetch|Load failed|NetworkError when attempting to fetch/i;
const EXTENSION = /^(chrome|moz|safari(-web)?|ms-browser)-extension:\/\//;

/** True when every script address in the stack belongs to a browser extension. */
function fromExtension(stack: string, file?: string): boolean {
  if (file && EXTENSION.test(file)) return true;
  const urls = stack.match(/[a-z][a-z-]*:\/\/[^\s)]+/gi) ?? [];
  return urls.length > 0 && urls.every((u) => EXTENSION.test(u));
}

/** Send an unexpected error to the owner's dashboard (`client_error`), unless it is noise. */
export function reportError(err: unknown, file?: string) {
  try {
    if (err instanceof ApiError && err.status === 0) return; // could not reach the API
    const message = (
      err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '')
    ).trim();
    const stack = err instanceof Error ? (err.stack ?? '') : '';
    if (!message || NOISE.test(message) || fromExtension(stack, file)) return;
    report('client_error', message.slice(0, 300), {
      detail: { app: 'store', stack: stack.slice(0, 1500), ua: navigator.userAgent.slice(0, 200) },
      path: location.pathname,
    });
  } catch {
    /* never let the reporter throw from an error handler */
  }
}

/** Listens once for errors nobody caught (mounted in the shop layout). */
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportError(e.error ?? e.message, e.filename);
    const onRejection = (e: PromiseRejectionEvent) => reportError(e.reason);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}
