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

/* ─────────────────────────────────────────────────────────────────────────────
 * Learning from the shop (docs/api-contract-feedback.md): what visitors looked
 * for and did not find, and the errors the store, the dashboard and the server
 * ran into. Read by /opportunities, /errors and the home card.
 * ───────────────────────────────────────────────────────────────────────────── */

export type OpportunityDays = 7 | 30 | 90;
export type SearchMiss = { query: string; count: number; lastAt: string };
export type Suggestion = {
  id: string;
  text: string;
  contact: string | null;
  createdAt: string;
  user: { id: string; fullName: string; phone: string | null } | null;
};
export type AbandonedProduct = {
  productId: string;
  sku: string;
  nameAr: string;
  checkouts: number;
  customers: number;
  lastAt: string;
};
export type ViewedBrand = { brandKey: string; title: string; views: number };
export type Opportunities = {
  days: number;
  searchMisses: SearchMiss[];
  suggestions: Suggestion[];
  abandoned: AbandonedProduct[];
  mostViewed: ViewedBrand[];
};

export type ErrorDays = 1 | 7 | 30;
export type ErrorSource = 'store' | 'admin' | 'server';
export type ErrorGroup = {
  source: ErrorSource;
  message: string;
  count: number;
  lastAt: string;
  lastPath: string | null;
  lastUa: string | null;
  stack: string | null;
};

/** GET /admin/opportunities (reports.read): search misses, suggestions, abandoned checkouts, most viewed brands. */
export const opportunitiesPath = (days: OpportunityDays = 30) => `/admin/opportunities?days=${days}`;
export const getOpportunities = (days?: OpportunityDays) => api.get<Opportunities>(opportunitiesPath(days));

/** GET /admin/errors (reports.read): error groups, newest first, at most 50. */
export const errorsPath = (days: ErrorDays = 7) => `/admin/errors?days=${days}`;
export const getErrors = (days?: ErrorDays) => api.get<ErrorGroup[]>(errorsPath(days));

export type StoreEvent = {
  kind: 'search_miss' | 'brand_view' | 'suggestion' | 'client_error';
  value: string;
  path?: string;
  detail?: Record<string, unknown>;
};

/**
 * POST /events, fire-and-forget: no token, no retry, no waking banner, and it
 * survives a page unload (keepalive). A failure is swallowed on purpose.
 */
export function sendEvent(ev: StoreEvent): void {
  try {
    void fetch(`${BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ev),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never let reporting break the page */
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Product prices per currency (products list, quick edit, product form).
 * A customer outside the base currency pays either a FIXED price the owner set
 * (ProductPrice) or the dollar price converted at the latest rate and rounded
 * the way the API does it (PricingService.round). Self-contained block.
 * ───────────────────────────────────────────────────────────────────────────── */

export type ShopCurrency = {
  code: string;
  nameAr: string;
  symbol: string;
  decimals: number;
  isBase: boolean;
  isActive: boolean;
  sortOrder: number;
  roundingMode: string;
  roundingStep: string | number | null;
};
/** GET /catalog/rates: 1 base = rates[code]. */
export type FxRates = { base: string; rates: Record<string, number> };
/** A fixed price as the admin product endpoints return it (amount as a decimal string). */
export type FixedPrice = { currencyCode: string; sellPrice: string | number; isActive?: boolean };

export const CURRENCIES_PATH = '/catalog/currencies';
export const RATES_PATH = '/catalog/rates';

const PRICE_IN: Record<string, string> = {
  MRU: 'بالأوقية',
  XOF: 'بالفرنك (CFA)',
  DZD: 'بالدينار',
  EUR: 'باليورو',
};
/** "السعر بالأوقية", "السعر بالدينار"… */
export const priceInLabel = (c: Pick<ShopCurrency, 'code' | 'nameAr'>) =>
  `السعر ${PRICE_IN[c.code] ?? `بـ${c.nameAr}`}`;

/** The currencies customers can pay in besides the dollar, Mauritania first. */
export function localCurrencies(all: ShopCurrency[] | null | undefined): ShopCurrency[] {
  return (all ?? [])
    .filter((c) => c.isActive && !c.isBase)
    .sort((a, b) => (a.code === 'MRU' ? -1 : b.code === 'MRU' ? 1 : a.sortOrder - b.sortOrder));
}

function roundBy(v: number, mode: string): number {
  const x = Number(v.toFixed(8)); // drop binary noise: 4.35 * 100 = 434.99999999999994
  return mode === 'UP' ? Math.ceil(x) : mode === 'DOWN' ? Math.floor(x) : Math.round(x);
}

/** Same as the API: round to the currency's decimals, then snap to its step (e.g. whole ouguiya). */
export function roundForCurrency(
  value: number,
  c: Pick<ShopCurrency, 'decimals' | 'roundingMode' | 'roundingStep'>,
): number {
  const f = 10 ** c.decimals;
  let r = roundBy(value * f, c.roundingMode) / f;
  const step = Number(c.roundingStep ?? 0);
  if (step > 0) r = roundBy(r / step, c.roundingMode) * step;
  return Number(r.toFixed(Math.max(c.decimals, 4)));
}

/**
 * What a customer pays in `c` for a dollar amount when no fixed price is set,
 * after an optional discount. Null when there is no rate for that currency.
 * (The API may add an FX markup setting on top; it is 0 by default.)
 */
export function autoLocalPrice(usd: number, rate: number | undefined, c: ShopCurrency, discountPercent = 0) {
  if (!rate || !isFinite(usd)) return null;
  return roundForCurrency(usd * rate * (1 - discountPercent / 100), c);
}

/** What a customer pays for a fixed price after the owner's discount (the discount applies to it too). */
export const fixedAfterDiscount = (fixed: number, c: ShopCurrency, discountPercent = 0) =>
  roundForCurrency(fixed * (1 - discountPercent / 100), c);

/** While typing an amount: Arabic digits → Latin, "٫" or "," → ".", only digits and one point. */
export function cleanAmount(s: string): string {
  const latin = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.')
    .replace(/[^0-9.]/g, '');
  const dot = latin.indexOf('.');
  return dot < 0 ? latin : latin.slice(0, dot + 1) + latin.slice(dot + 1).replace(/\./g, '');
}

/** "100.0000" → "100" for an input field. */
export const amountText = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '' : String(Number(v));

/** The owner's fixed prices by currency, as input text (an inactive row counts as automatic). */
export function fixedTexts(prices: FixedPrice[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of prices ?? []) if (p.isActive !== false) out[p.currencyCode] = amountText(p.sellPrice);
  return out;
}

/** True when the fixed-price inputs differ from what is saved. */
export function fixedChanged(now: Record<string, string>, saved: Record<string, string>): boolean {
  const keys = new Set([...Object.keys(now), ...Object.keys(saved)]);
  for (const k of keys) {
    const a = (now[k] ?? '').trim();
    const b = (saved[k] ?? '').trim();
    if (a === b) continue;
    if (a === '' || b === '' || Number(a) !== Number(b)) return true;
  }
  return false;
}

/**
 * The `prices` list for POST/PATCH /admin/catalog/products. The API replaces
 * every fixed price with this list, so a currency the owner cleared is left
 * out (back to automatic) and fixed prices of currencies not shown are kept.
 */
export function pricesBody(
  texts: Record<string, string>,
  shown: string[],
  saved: FixedPrice[] | null | undefined,
): { currencyCode: string; sellPrice: number }[] {
  const out: { currencyCode: string; sellPrice: number }[] = [];
  for (const code of shown) {
    const t = (texts[code] ?? '').trim();
    if (t !== '') out.push({ currencyCode: code, sellPrice: Number(t) });
  }
  for (const p of saved ?? []) {
    if (!shown.includes(p.currencyCode) && p.isActive !== false) {
      out.push({ currencyCode: p.currencyCode, sellPrice: Number(p.sellPrice) });
    }
  }
  return out;
}

/** A product as the admin endpoints return it: the fields PATCH needs back, plus fixed prices. */
export type AdminProduct = {
  id: string;
  sku: string;
  type: string;
  delivery: string;
  nameAr: string;
  nameEn: string;
  categoryId: string;
  gameId?: string | null;
  costPrice: number | string;
  sellPrice: number | string;
  discountPercent?: number | null;
  description?: string | null;
  imageUrl?: string | null;
  stockQty: number | null;
  maxPerOrder?: number | null;
  isActive: boolean;
  isFeatured: boolean;
  prices?: FixedPrice[];
};

/**
 * PATCH /admin/catalog/products/:id validates the whole product and rejects
 * unknown fields, so a quick edit sends every DTO field from the row it has,
 * with the changed ones on top.
 */
export function productPatchBody(p: AdminProduct, changes: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sku: p.sku,
    type: p.type,
    delivery: p.delivery,
    nameAr: p.nameAr,
    nameEn: p.nameEn,
    categoryId: p.categoryId,
    gameId: p.gameId || null,
    costPrice: Number(p.costPrice),
    sellPrice: Number(p.sellPrice),
    discountPercent: p.discountPercent ?? null,
    description: p.description ?? null,
    imageUrl: p.imageUrl ?? null,
    stockQty: p.stockQty,
    isActive: p.isActive,
    isFeatured: p.isFeatured,
    ...changes,
  };
  // non-nullable in the database: omit rather than send null
  if (p.maxPerOrder !== null && p.maxPerOrder !== undefined) body.maxPerOrder = p.maxPerOrder;
  return body;
}

export const updateProduct = (id: string, body: Record<string, unknown>) =>
  api.patch<AdminProduct>(`/admin/catalog/products/${id}`, body);

/* ─────────────────────────────────────────────────────────────────────────────
 * Owner's reports page (/reports): GET /admin/reports/summary (reports.read).
 * Money is in USD (the base currency), as strings with two decimals. A paid
 * order is counted on the day it was paid, like the dashboard home's "today".
 * ───────────────────────────────────────────────────────────────────────────── */

export type ReportPayGateway = 'MANUAL' | 'WALLET' | 'CARD' | 'OTHER';
export type ReportPayMethod = {
  /** The transfer app's name (Bankily, Masrvi…), or "المحفظة" / "بطاقة" / "أخرى". */
  method: string;
  gateway: ReportPayGateway;
  /** The logo the owner chose for that app on the payment-methods page. */
  logo: string | null;
  orders: number;
  revenue: string;
  /** Percent of the period's sales. */
  share: number;
};
export type ReportSummary = {
  range: { from: string; to: string };
  totals: {
    /** Net sales: refunds and paid lines that failed or were cancelled are already taken off. */
    revenue: string;
    cost: string;
    profit: string;
    marginPercent: number;
    orders: number;
    itemsDelivered: number;
    averageOrder: string;
  };
  losses: {
    /** Already taken off the sales: shown for the record, never a loss on top. */
    refunds: string;
    refundCount: number;
    belowCost: { productId: string; sku: string; nameAr: string; units: number; loss: string }[];
    belowCostTotal: string;
    /** Paid orders/lines that failed or were cancelled and are not refunded yet: owed, not lost. */
    owed: { count: number; value: string };
    /** The only real loss: what was sold under its cost (= belowCostTotal). */
    total: string;
  };
  today: {
    revenue: string;
    cost: string;
    profit: string;
    orders: number;
    /** Money that actually came in today; the wallet is not in it (see walletUsed). */
    cashByMethod: { method: string; gateway: ReportPayGateway; logo: string | null; amount: string; orders: number }[];
    /** Paid today from wallet balances received earlier: not new cash. */
    walletUsed: { amount: string; orders: number };
  };
  byMethod: ReportPayMethod[];
  topCustomers: {
    id: string;
    fullName: string;
    phone: string | null;
    country: string | null;
    orders: number;
    spent: string;
    profit: string;
    lastOrderAt: string;
  }[];
  topProducts: { productId: string; sku: string; nameAr: string; units: number; revenue: string; profit: string }[];
  byCountry: { country: string | null; orders: number; revenue: string }[];
  /** Every day of the period, zeros included (YYYY-MM-DD, UTC). */
  series: { date: string; revenue: string; cost: string; profit: string; orders: number }[];
};

/** `from` / `to` are YYYY-MM-DD (UTC); `to` includes its whole day. Both omitted: this month. */
export const reportSummaryPath = (from?: string, to?: string) => {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const s = q.toString();
  return `/admin/reports/summary${s ? `?${s}` : ''}`;
};
export const getReportSummary = (from?: string, to?: string) => api.get<ReportSummary>(reportSummaryPath(from, to));
