import type {
  AppNotification,
  BestSeller,
  MyCode,
  PriceWatch,
  Rates,
  ReviewSummary,
  SavedInput,
  StoreStats,
  SupportTicket,
  Banner,
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
import { getLang, tNow } from './i18n';
import { withRef } from './ref-store';

/**
 * In French or English the catalogue shows the English names: products carry
 * nameAr and nameEn, and the rest of the store reads nameAr. Swapping here
 * once keeps every card, cart line and brand title in the visitor's language.
 */
function localizeProduct(p: Product): Product {
  if (getLang() === 'ar') return p;
  return {
    ...p,
    nameAr: p.nameEn || p.nameAr,
    category: p.category && { ...p.category, nameAr: p.category.nameEn || p.category.nameAr },
    game: p.game && { ...p.game, nameAr: p.game.nameEn || p.game.nameAr },
  };
}

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
    /** The whole error body, for details beyond the message (e.g. which cart line). */
    public body?: Record<string, unknown>,
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
        throw new ApiError(0, tNow('تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حدّث الصفحة.'));
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

export async function request<T>(path: string, opts: Opts = {}): Promise<T> {
  const { method = 'GET', body, auth = false, idempotent = false, retry = true } = opts;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // a file goes as multipart; the browser sets the boundary itself
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
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
      body: form ? (body as FormData) : body !== undefined ? JSON.stringify(body) : undefined,
      // the public catalogue may come from the browser cache (the API keeps it a minute);
      // anything about the customer always goes to the server
      cache: method === 'GET' && !auth && path.startsWith('/catalog/') ? 'default' : 'no-store',
    },
    method === 'GET',
  );

  // transparent refresh once on 401 for authed requests
  if (res.status === 401 && auth && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(path, { ...opts, retry: false });
    // the session is over (signed out elsewhere, or expired): sign in again and come back here
    signInAgain();
    throw new ApiError(401, tNow('انتهت جلستك. سجّل الدخول من جديد.'));
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
    const msg = Array.isArray(d.message)
      ? d.message.join(getLang() === 'ar' ? '، ' : ', ')
      : d.message || d.error || tNow('خطأ {status}', { status: res.status });
    throw new ApiError(res.status, msg, d.error, typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined);
  }
  return data as T;
}

function signInAgain() {
  try {
    const here = location.pathname + location.search;
    if (!location.pathname.startsWith('/login')) location.assign(`/login?next=${encodeURIComponent(here)}`);
  } catch {
    /* SSR */
  }
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
      // the ?ref code a visitor came with: kept by the server only when this creates the account
      { method: 'POST', body: withRef(body) },
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
    return request<Paginated<Product>>(`/catalog/products${qs(params)}`).then((r) => ({
      ...r,
      data: r.data.map(localizeProduct),
    }));
  },
  product(idOrSku: string, currency?: string) {
    return request<Product>(`/catalog/products/${encodeURIComponent(idOrSku)}${qs({ currency })}`).then(localizeProduct);
  },
  banners() {
    return request<Banner[]>('/catalog/banners');
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
  /** The screenshot of the transfer; required before reporting it. */
  uploadProof(paymentId: string, image: Blob) {
    const body = new FormData();
    body.append('file', image, 'receipt.jpg');
    return request<{ proofId: string }>(`/payments/${paymentId}/proof`, { method: 'POST', body, auth: true });
  },
  submitTransfer(paymentId: string, body: { accountId: string; payerPhone: string; reference?: string; payerName?: string }) {
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

// ─────────────── the 50 additions (docs/api-contract-50.md) ───────────────

/** Public store facts: best sellers, trust numbers, exchange rates, reviews. */
export const store = {
  bestSellers(limit = 8) {
    return request<BestSeller[]>(`/catalog/best-sellers${qs({ limit })}`);
  },
  stats() {
    return request<StoreStats>('/catalog/stats');
  },
  rates() {
    return request<Rates>('/catalog/rates');
  },
  reviews(productIds: string[]) {
    return request<ReviewSummary>(`/catalog/reviews${qs({ productIds: productIds.join(',') })}`);
  },
};

/** The signed-in customer's own data. */
export const me = {
  updateProfile(body: { fullName?: string; country?: string; city?: string; locale?: string; defaultCurrency?: string }) {
    return request<Me>('/users/me', { method: 'PATCH', body, auth: true });
  },
  savedInputs(gameId?: string) {
    return request<SavedInput[]>(`/me/saved-inputs${qs({ gameId })}`, { auth: true });
  },
  saveInput(body: { gameId: string; label?: string; values: Record<string, string> }) {
    return request<SavedInput>('/me/saved-inputs', { method: 'POST', body, auth: true });
  },
  deleteInput(id: string) {
    return request<{ deleted: true }>(`/me/saved-inputs/${id}`, { method: 'DELETE', auth: true });
  },
  favorites() {
    return request<string[]>('/me/favorites', { auth: true });
  },
  addFavorite(brandKey: string) {
    return request<{ brandKey: string }>(`/me/favorites/${encodeURIComponent(brandKey)}`, { method: 'PUT', auth: true });
  },
  removeFavorite(brandKey: string) {
    return request<{ deleted: true }>(`/me/favorites/${encodeURIComponent(brandKey)}`, { method: 'DELETE', auth: true });
  },
  watches() {
    return request<PriceWatch[]>('/me/watches', { auth: true });
  },
  watch(productId: string, kind: 'price' | 'stock') {
    return request<PriceWatch>('/me/watches', { method: 'POST', body: { productId, kind }, auth: true });
  },
  unwatch(id: string) {
    return request<{ deleted: true }>(`/me/watches/${id}`, { method: 'DELETE', auth: true });
  },
  notifications(page = 1, limit = 20) {
    return request<Paginated<AppNotification>>(`/notifications${qs({ page, limit })}`, { auth: true });
  },
  unreadCount() {
    return request<{ count: number }>('/notifications/unread-count', { auth: true });
  },
  markRead(ids?: string[]) {
    return request<{ updated: number }>('/notifications/read', { method: 'POST', body: ids ? { ids } : {}, auth: true });
  },
  codes() {
    return request<MyCode[]>('/me/codes', { auth: true });
  },
  reviewed() {
    return request<string[]>('/me/reviews', { auth: true });
  },
  review(body: { orderItemId: string; rating: number; comment?: string }) {
    return request<{ id: string }>('/reviews', { method: 'POST', body, auth: true });
  },
  tickets() {
    return request<SupportTicket[]>('/support/tickets', { auth: true });
  },
  openTicket(body: { orderId?: string; subject: string; message: string }) {
    return request<SupportTicket>('/support/tickets', { method: 'POST', body, auth: true });
  },
  walletTransactions() {
    return request<Paginated<{ id: string; type: string; amount: string; currencyCode: string; balanceAfter?: string; description?: string | null; createdAt: string }>>(
      '/wallet/transactions',
      { auth: true },
    );
  },
};
