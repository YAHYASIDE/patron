'use client';

import { BASE, getAccess } from './api';

/**
 * What the shop learns from its visitors (docs/api-contract-feedback.md):
 * searches that found nothing, brand pages opened, product suggestions and
 * client errors, sent to POST /events for the owner's dashboard.
 *
 * Fire-and-forget: never throws, never retries, nothing on the server. At most
 * MAX_PER_LOAD events per page load, and the same kind + value once per
 * browser session, so a loop or a busy visitor cannot flood the API.
 */
export type EventKind = 'search_miss' | 'brand_view' | 'suggestion' | 'client_error';

const MAX_PER_LOAD = 20;
const SENT_KEY = 'patron_events_sent';
const MAX_DETAIL = 2000;
let sentThisLoad = 0;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Remember kind + value for this session; false when it was already sent. */
function firstTime(id: string): boolean {
  try {
    const seen: unknown = JSON.parse(sessionStorage.getItem(SENT_KEY) ?? '[]');
    const list = Array.isArray(seen) ? seen.filter((x): x is string => typeof x === 'string') : [];
    if (list.includes(id)) return false;
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...list, id].slice(-200)));
  } catch {
    /* private mode: the per-load cap still applies */
  }
  return true;
}

/** Keep the detail within the contract's 2000 characters by shortening its longest text. */
function fit(detail: Record<string, unknown>): Record<string, unknown> {
  const out = { ...detail };
  let over = JSON.stringify(out).length - MAX_DETAIL;
  while (over > 0) {
    const texts = Object.entries(out).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && !!e[1],
    );
    if (!texts.length) return {};
    const [key, text] = texts.reduce((a, b) => (b[1].length > a[1].length ? b : a));
    out[key] = text.slice(0, Math.max(0, text.length - over - 16));
    over = JSON.stringify(out).length - MAX_DETAIL;
  }
  return out;
}

export function report(
  kind: EventKind,
  value: string,
  { detail, path }: { detail?: Record<string, unknown>; path?: string } = {},
): void {
  if (typeof window === 'undefined') return;
  const v = clip(value.trim(), 300);
  if (!v || sentThisLoad >= MAX_PER_LOAD || !firstTime(`${kind}|${v.toLowerCase()}`)) return;
  sentThisLoad++;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getAccess();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const body: Record<string, unknown> = { kind, value: v, path: clip(path ?? location.pathname, 200) };
    if (detail) body.detail = fit(detail);
    fetch(`${BASE}/events`, { method: 'POST', headers, body: JSON.stringify(body), keepalive: true }).catch(
      () => undefined,
    );
  } catch {
    /* reporting must never break the page */
  }
}
