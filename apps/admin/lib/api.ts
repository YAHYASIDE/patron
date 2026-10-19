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

/** Shown when the server answers that a route does not exist (an older API). */
export const NOT_READY = 'غير متاح بعد';
export const isNotReady = (e: unknown) => e instanceof ApiError && e.message === NOT_READY;

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
  // a file goes as multipart; the browser sets the boundary itself
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  const token = auth ? getAccess() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchWaking(
    `${BASE}${path}`,
    { method, headers, body: form ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined },
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
    // the route itself is missing: this server does not have the feature yet
    if (res.status === 404 && typeof data?.message === 'string' && /^Cannot [A-Z]+ \//.test(data.message)) {
      throw new ApiError(404, NOT_READY, data.correlationId);
    }
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
  /** Send one image as multipart field "file". */
  upload: <T>(path: string, file: Blob) => {
    const body = new FormData();
    body.append('file', file, 'image');
    return raw<T>(path, { method: 'POST', body });
  },
  /** An image only staff may see (e.g. a transfer receipt), as a local object URL. */
  async imageUrl(path: string): Promise<string> {
    const res = await fetchAuthed(path);
    if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'لا توجد صورة.' : `خطأ ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  /** A file only staff may download (CSV export, backup): fetched with the token, saved by the browser. */
  async download(path: string, fallbackName: string): Promise<void> {
    let res: Response;
    try {
      res = await fetchAuthed(path);
    } catch {
      throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم أعد المحاولة.');
    }
    if (!res.ok) {
      let message = `خطأ ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string | string[] };
        const m = Array.isArray(body.message) ? body.message.join('، ') : body.message;
        if (res.status === 404 && m && /^Cannot [A-Z]+ \//.test(m)) message = NOT_READY;
        else if (res.status === 403) message = 'ليست لديك صلاحية لهذا التنزيل.';
        else if (m) message = m;
      } catch {
        /* not JSON: keep the status */
      }
      throw new ApiError(res.status, message);
    }
    // the server names the file (e.g. orders-2026-10-19.csv); otherwise use ours
    const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '');
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = named ? decodeURIComponent(named[1]) : fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },
};

/** A GET with the bearer token, refreshed once on a 401 (for binary bodies). */
async function fetchAuthed(path: string): Promise<Response> {
  const token = getAccess();
  let res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 401 && getRefresh() && (await tryRefresh())) {
    res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${getAccess()}` } });
  }
  return res;
}

/** Where the API serves public uploads (logos, banner pictures). */
export const uploadUrl = (path: string) => `${BASE}${path}`;

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
