import type {
  Category,
  Currency,
  Game,
  ManualAccount,
  Me,
  Order,
  Paginated,
  Cursored,
  Product,
  Quote,
  TokenPair,
} from './types';

/**
 * Storefront API client for the public Patron API (/api/v1).
 * BASE is inlined at build time from NEXT_PUBLIC_API_URL (see Dockerfile);
 * falls back to a local API for development.
 */
export const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';

const ACCESS_KEY = 'patron_access';
const REFRESH_KEY = 'patron_refresh';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// ---- token storage (per-browser; wrapped so SSR / private mode never throws) ----
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
function storeTokens(t: TokenPair) {
  try {
    localStorage.setItem(ACCESS_KEY, t.accessToken);
    localStorage.setItem(REFRESH_KEY, t.refreshToken);
  } catch {
    /* ignore */
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

function idempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

type Opts = {
  method?: string;
  body?: unknown;
  auth?: boolean;
  idempotent?: boolean;
  retry?: boolean;
};

/*
 * Cold starts. On the hosting free tier the API sleeps after ~15 idle minutes
 * and takes up to a minute to wake. While it does, requests fail at the
 * network level or get a non-JSON gateway page. GETs are safe to repeat, so
 * they are retried with backoff for about 75s, and the shop shows a "waking
 * up" banner (WakeBanner) instead of an error. Writes are never auto-retried.
 */
export const WAKING_EVENT = 'patron-api-waking';
const WAKE_DELAYS_MS = [1500, 2500, 4000, 6000, 8000, 10000, 10000, 10000, 12000, 12000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Several requests can be waiting at once; the banner shows while any is.
let waiting = 0;
function setWaiting(delta: 1 | -1) {
  waiting = Math.max(0, waiting + delta);
  try {
    window.dispatchEvent(new CustomEvent(WAKING_EVENT, { detail: waiting > 0 }));
  } catch {
    /* SSR */
  }
}

async function fetchWaking(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
  let counted = false;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      try {
        res = await fetch(url, init);
      } catch {
        res = null; // network error: asleep, or offline
      }
      const gatewayPage =
        res !== null && res.status >= 502 && res.status <= 504 && !(res.headers.get('content-type') ?? '').includes('json');
      if (res !== null && !gatewayPage) return res;
      if (!retryable || attempt >= WAKE_DELAYS_MS.length) {
        throw new ApiError(0, 'تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حدّث الصفحة.');
      }
      if (!counted) {
        counted = true;
        setWaiting(1);
      }
      await sleep(WAKE_DELAYS_MS[attempt]);
    }
  } finally {
    if (counted) setWaiting(-1);
  }
}

async function request<T>(path: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', body, auth = false, idempotent = false, retry = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotent) headers['Idempotency-Key'] = idempotencyKey();
  if (auth) {
    const token = getAccess();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetchWaking(
    `${BASE}${path}`,
    {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    },
    method === 'GET',
  );

  // transparent refresh once on 401 for authed requests
  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const d = (data ?? {}) as { message?: string | string[]; error?: string };
    const msg = Array.isArray(d.message) ? d.message.join('، ') : d.message || d.error || `خطأ ${res.status}`;
    throw new ApiError(res.status, msg, d.error);
  }
  return data as T;
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefresh();
  if (!refreshToken) return false;
  try {
    const t = await request<TokenPair>('/auth/refresh', { method: 'POST', body: { refreshToken }, retry: false });
    storeTokens(t);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

const qs = (params: Record<string, string | number | boolean | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== null) sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
};

/** Wake a sleeping API early (a retried GET), before a POST that is not retried. */
export function warmUp() {
  request('/health/live').catch(() => undefined);
}

// ─────────────── auth ───────────────
export const auth = {
  async login(email: string, password: string) {
    const t = await request<TokenPair>('/auth/login', { method: 'POST', body: { email, password } });
    storeTokens(t);
    return t;
  },
  async logout() {
    const refreshToken = getRefresh();
    try {
      if (refreshToken) await request('/auth/logout', { method: 'POST', body: { refreshToken } });
    } finally {
      clearTokens();
    }
  },
  me() {
    return request<Me>('/auth/me', { auth: true });
  },
  /** WhatsApp sign-in: a new number signs straight in; a verified one needs the code the shop sends. */
  async phoneStart(body: { phone: string; fullName?: string }) {
    const res = await request<({ status: 'SIGNED_IN' } & TokenPair) | { status: 'CODE_REQUIRED' }>(
      '/auth/phone/start',
      { method: 'POST', body },
    );
    if (res.status === 'SIGNED_IN') storeTokens(res);
    return res.status;
  },
  async phoneLogin(phone: string, code: string) {
    const t = await request<TokenPair>('/auth/phone/login', { method: 'POST', body: { phone, code } });
    storeTokens(t);
    return t;
  },
  requestPhoneCode(phone?: string) {
    return request<{ status: 'SENT' | 'VERIFIED'; phone: string }>('/auth/phone/request-code', {
      method: 'POST',
      body: phone ? { phone } : {},
      auth: true,
    });
  },
  verifyPhone(code: string) {
    return request<{ message: string }>('/auth/phone/verify', { method: 'POST', body: { code }, auth: true });
  },
};

// ─────────────── catalog (public) ───────────────
export const catalog = {
  currencies() {
    return request<Currency[]>('/catalog/currencies');
  },
  categories() {
    return request<Category[]>('/catalog/categories');
  },
  games(params: { categoryId?: string; isFeatured?: boolean; search?: string; page?: number; limit?: number } = {}) {
    return request<Paginated<Game>>(`/catalog/games${qs(params)}`);
  },
  game(idOrSlug: string) {
    return request<Game>(`/catalog/games/${encodeURIComponent(idOrSlug)}`);
  },
  products(
    params: {
      categoryId?: string;
      gameId?: string;
      type?: string;
      isFeatured?: boolean;
      search?: string;
      currency?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    return request<Paginated<Product>>(`/catalog/products${qs(params)}`);
  },
  product(idOrSku: string, currency?: string) {
    return request<Product>(`/catalog/products/${encodeURIComponent(idOrSku)}${qs({ currency })}`);
  },
};

// ─────────────── checkout / orders / payments (customer) ───────────────
export const shop = {
  quote(body: {
    items: { productId: string; quantity: number; inputs?: { key: string; value: string }[] }[];
    currency?: string;
    couponCode?: string;
  }) {
    return request<Quote>('/checkout/quotes', { method: 'POST', body, auth: true });
  },
  createOrder(quoteId: string) {
    return request<Order>('/checkout/orders', { method: 'POST', body: { quoteId }, auth: true, idempotent: true });
  },
  order(id: string) {
    return request<Order>(`/orders/${id}`, { auth: true });
  },
  orders(params: { cursor?: string; limit?: number; status?: string } = {}) {
    return request<Cursored<Order>>(`/orders${qs(params)}`, { auth: true });
  },
  reveal(itemId: string) {
    return request<{ resultType: string; value: string; deliveredAt?: string }[]>(
      `/orders/items/${itemId}/reveal`,
      { method: 'POST', auth: true },
    );
  },
  paymentMethods() {
    return request<string[]>('/payments/methods');
  },
  pay(orderId: string, gateway: string, returnUrl?: string) {
    return request<{ paymentId: string; status: string; gatewayRef?: string; redirectUrl?: string }>('/payments', {
      method: 'POST',
      body: { orderId, gateway, returnUrl },
      auth: true,
      idempotent: true,
    });
  },
  /** The shop's own WhatsApp number (null when the owner has not set one). */
  info() {
    return request<{ supportWhatsapp: string | null }>('/shop/info');
  },
  manualAccounts() {
    return request<{ accounts: ManualAccount[]; note: string | null }>('/payments/manual-accounts');
  },
  submitTransfer(paymentId: string, body: { accountId: string; reference: string; payerName?: string; payerPhone?: string }) {
    return request<{ paymentId: string; status: string }>(`/payments/${paymentId}/transfer`, {
      method: 'POST',
      body,
      auth: true,
    });
  },
  confirmPayment(paymentId: string) {
    return request<{ status: string }>(`/payments/${paymentId}/confirm`, { method: 'POST', auth: true });
  },
  wallet() {
    return request<{ currencyCode: string; balance: string; currency?: Currency }[]>('/wallet', { auth: true });
  },
};
