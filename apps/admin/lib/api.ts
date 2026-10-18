/**
 * Thin client for the Patron API (`/api/v1`).
 * Holds the access token in memory + localStorage, attaches it as a Bearer
 * header, and transparently refreshes once on a 401.
 */

const BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
  'http://localhost:3000/api/v1';

const ACCESS_KEY = 'patron.access';
const REFRESH_KEY = 'patron.refresh';

export type Tokens = { accessToken: string; refreshToken: string; expiresIn?: number };

export function getAccess(): string | null {
  try {
    return localStorage.getItem(ACCESS_KEY);
  } catch {
    return null;
  }
}
function getRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}
export function storeTokens(t: Tokens) {
  try {
    localStorage.setItem(ACCESS_KEY, t.accessToken);
    localStorage.setItem(REFRESH_KEY, t.refreshToken);
  } catch {
    /* ignore: private window */
  }
}
export function clearTokens() {
  try {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* ignore */
  }
}
export function isAuthed(): boolean {
  return !!getAccess();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}

type Opts = { method?: string; body?: unknown; auth?: boolean; retry?: boolean };

/*
 * Cold starts: on the free hosting tier the API sleeps after ~15 idle minutes
 * and needs up to a minute to wake, failing at the network level or with a
 * non-JSON gateway page meanwhile. GETs are retried with backoff (~75s) and
 * the layout shows a "waking" banner; writes are never auto-retried.
 */
export const WAKING_EVENT = 'patron-api-waking';
const WAKE_DELAYS_MS = [1500, 2500, 4000, 6000, 8000, 10000, 10000, 10000, 12000, 12000];
let waiting = 0;
function setWaiting(delta: 1 | -1) {
  waiting = Math.max(0, waiting + delta);
  window.dispatchEvent(new CustomEvent(WAKING_EVENT, { detail: waiting > 0 }));
}

async function fetchWaking(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
  let counted = false;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch(url, init);
      } catch {
        res = null;
      }
      const gatewayPage =
        res !== null && res.status >= 502 && res.status <= 504 && !(res.headers.get('content-type') ?? '').includes('json');
      if (res !== null && !gatewayPage) return res;
      if (!retryable || attempt >= WAKE_DELAYS_MS.length) {
        throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم حدّث الصفحة.');
      }
      if (!counted) {
        counted = true;
        setWaiting(1);
      }
      await new Promise((r) => setTimeout(r, WAKE_DELAYS_MS[attempt]));
    }
  } finally {
    if (counted) setWaiting(-1);
  }
}

async function raw<T>(path: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getAccess() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWaking(
    `${BASE}${path}`,
    { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined },
    method === 'GET',
  );

  if (res.status === 401 && auth && retry && getRefresh()) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw<T>(path, { ...opts, retry: false });
  }

  const text = await res.text();
  let data: { message?: string | string[]; error?: string; correlationId?: string } | null = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // a non-JSON body (e.g. a proxy error page) is a server problem, not data
    throw new ApiError(res.status, `الخادم غير متاح حاليًا (${res.status}). حاول بعد لحظات.`);
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `خطأ ${res.status}`;
    throw new ApiError(res.status, Array.isArray(msg) ? msg.join('، ') : msg, data?.correlationId);
  }
  return data as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefresh();
  if (!refreshToken) return false;
  try {
    const t = await raw<Tokens>('/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
      auth: false,
      retry: false,
    });
    storeTokens(t);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export const api = {
  get: <T>(path: string) => raw<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => raw<T>(path, { method: 'PUT', body }),
  del: <T>(path: string) => raw<T>(path, { method: 'DELETE' }),
};

export async function login(email: string, password: string): Promise<Tokens> {
  const t = await raw<Tokens>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
    retry: false,
  });
  storeTokens(t);
  return t;
}

export function logout() {
  clearTokens();
}
