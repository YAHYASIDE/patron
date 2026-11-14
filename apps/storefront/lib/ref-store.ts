/**
 * The referral code a visitor arrived with (`?ref=CODE` on any store link).
 * Kept for 30 days in localStorage and a cookie (either may be cleared), and
 * sent once, when the account is created. The server ignores it for an
 * existing account, an inactive agent or the agent's own code, so keeping it
 * longer than needed is harmless. No imports: lib/api.ts reads it.
 */
const KEY = 'patron_ref';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE = /^[A-Za-z0-9]{4,12}$/;

type Stored = { code: string; at: number };

function fromCookie(): Stored | null {
  try {
    const m = document.cookie.match(/(?:^|;\s*)patron_ref=([^;]+)/);
    if (!m) return null;
    const [code, at] = decodeURIComponent(m[1]).split('.');
    return CODE.test(code) ? { code, at: Number(at) || Date.now() } : null;
  } catch {
    return null;
  }
}

function fromStorage(): Stored | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Stored | null;
    return v && typeof v.code === 'string' && CODE.test(v.code) && typeof v.at === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** Remember a code; the first link a visitor followed stays until it expires. */
export function rememberRef(raw: string | null | undefined, now = Date.now()) {
  const code = (raw ?? '').trim().toUpperCase();
  if (!CODE.test(code)) return;
  const current = storedRef(now);
  if (current) return;
  const v: Stored = { code, at: now };
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode */
  }
  try {
    document.cookie = `${KEY}=${encodeURIComponent(`${code}.${now}`)}; path=/; max-age=${TTL_MS / 1000}; samesite=lax`;
  } catch {
    /* SSR */
  }
}

/** The live code, or null when there is none or it is older than 30 days. */
export function storedRef(now = Date.now()): string | null {
  if (typeof window === 'undefined') return null;
  const v = fromStorage() ?? fromCookie();
  return v && now - v.at < TTL_MS ? v.code : null;
}

/**
 * Read `ref` from the address, also when the sign-in redirect tucked the page
 * the visitor opened into `?next=/?ref=CODE`.
 */
export function captureRef(search: string = typeof window === 'undefined' ? '' : window.location.search) {
  try {
    const sp = new URLSearchParams(search);
    let ref = sp.get('ref');
    const next = sp.get('next');
    if (!ref && next) ref = new URLSearchParams(next.split('?')[1] ?? '').get('ref');
    if (ref) rememberRef(ref);
  } catch {
    /* a malformed address: nothing to keep */
  }
}

/** Add the code to an account-creation body when there is one. */
export function withRef<T extends object>(body: T): T & { ref?: string } {
  const ref = storedRef();
  return ref ? { ...body, ref } : body;
}
