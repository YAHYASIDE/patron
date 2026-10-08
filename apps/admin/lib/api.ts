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

async function raw<T>(path: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = auth ? getAccess() : null;
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && getRefresh()) {
    const refreshed = await tryRefresh();
    if (refreshed) return raw<T>(path, { ...opts, retry: false });
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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
