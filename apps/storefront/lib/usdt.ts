'use client';

import { useEffect, useState } from 'react';
import { ApiError, BASE, getAccess, request } from './api';
import { getLang, tNow } from './i18n';

// ─────────────── types (the API's shapes) ───────────────

export type UsdtNetwork = 'TRC20' | 'BEP20' | 'ERC20';
export type UsdtDelivery = 'ONCHAIN' | 'BINANCE';
export type UsdtStatus = 'NEW' | 'AWAITING_PAYMENT' | 'UNDER_REVIEW' | 'READY_TO_SEND' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

export type UsdtConfig =
  | { enabled: false }
  | {
      enabled: true;
      currencies: { code: string; rate: string; decimals: number }[];
      feePercent: string;
      feeFixedUsdt: string;
      minUsdt: string;
      maxUsdt: string;
      networks: UsdtNetwork[];
      binanceEnabled: boolean;
      expiryMinutes: number;
    };

export type UsdtQuote = {
  amountUsdt: string;
  currency: string;
  delivery: UsdtDelivery;
  network: UsdtNetwork | null;
  rate: string;
  feePercent: string;
  feeFixedUsdt: string;
  subtotal: string;
  fee: string;
  total: string;
  expiryMinutes: number;
};

export type UsdtOrder = {
  id: string;
  number: string;
  status: UsdtStatus;
  amountUsdt: string;
  delivery: UsdtDelivery;
  network: UsdtNetwork | null;
  address: string | null;
  binanceId: string | null;
  rate: string;
  currency: string;
  subtotal: string;
  fee: string;
  total: string;
  paymentMethod: string | null;
  payerPhone: string | null;
  paymentRef: string | null;
  hasProof: boolean;
  txid: string | null;
  rejectReason: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  events?: { action: string; status: UsdtStatus | null; at: string; note?: string }[];
};

export type UsdtOrderBody = {
  amountUsdt: string;
  currency: string;
  delivery: UsdtDelivery;
  network?: UsdtNetwork;
  address?: string;
  binanceId?: string;
  expectedTotal?: string;
};

// ─────────────── client ───────────────

/**
 * Creating an order sends a key the page keeps until the order exists, so a
 * retry after a dropped connection returns the same order instead of a second
 * one. The shared `request` helper makes a new key per call, hence this POST.
 */
async function postWithKey<T>(path: string, body: unknown, key: string, again = true): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json', 'Idempotency-Key': key };
  const token = getAccess();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new ApiError(0, tNow('تعذّر الاتصال بالخادم. تحقّق من اتصالك بالإنترنت ثم حدّث الصفحة.'));
  }
  if (res.status === 401 && again) {
    // the shared helper refreshes the session (or sends the customer to sign in)
    await request('/auth/me', { auth: true });
    return postWithKey<T>(path, body, key, false);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string | string[]; error?: string };
    const msg = Array.isArray(d.message) ? d.message.join(getLang() === 'ar' ? '، ' : ', ') : d.message || d.error || String(res.status);
    throw new ApiError(res.status, msg, d.error, typeof data === 'object' && data ? (data as Record<string, unknown>) : undefined);
  }
  return data as T;
}

export const usdt = {
  config() {
    return request<UsdtConfig>('/usdt/config');
  },
  quote(body: Omit<UsdtOrderBody, 'address' | 'binanceId' | 'expectedTotal'>) {
    return request<UsdtQuote>('/usdt/quote', { method: 'POST', body, auth: true });
  },
  create(body: UsdtOrderBody, key: string) {
    return postWithKey<UsdtOrder>('/usdt/orders', body, key);
  },
  orders() {
    return request<UsdtOrder[]>('/usdt/orders', { auth: true });
  },
  order(id: string) {
    return request<UsdtOrder>(`/usdt/orders/${encodeURIComponent(id)}`, { auth: true });
  },
  uploadProof(id: string, image: Blob) {
    const body = new FormData();
    body.append('file', image, 'receipt.jpg');
    return request<{ proofId: string }>(`/usdt/orders/${encodeURIComponent(id)}/proof`, { method: 'POST', body, auth: true });
  },
  pay(id: string, body: { method: string; payerPhone: string; reference?: string }) {
    return request<UsdtOrder>(`/usdt/orders/${encodeURIComponent(id)}/payment`, { method: 'POST', body, auth: true });
  },
  cancel(id: string) {
    return request<UsdtOrder>(`/usdt/orders/${encodeURIComponent(id)}/cancel`, { method: 'POST', auth: true });
  },
};

/** Whether to show the USDT entry in the menu: only once the owner has switched the service on. */
let enabledOnce: Promise<boolean> | null = null;
export function useUsdtEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    enabledOnce ??= usdt
      .config()
      .then((c) => c.enabled)
      .catch(() => {
        enabledOnce = null; // asked again on the next page
        return false;
      });
    enabledOnce.then((v) => alive && setOn(v));
    return () => {
      alive = false;
    };
  }, []);
  return on;
}

// ─────────────── error codes → the customer's language ───────────────

const ERRORS: Record<string, string> = {
  USDT_DISABLED: 'شراء USDT غير متاح حاليًا.',
  PHONE_NOT_VERIFIED: 'أكّد رقم واتساب أولًا.',
  USDT_COUNTRY_BLOCKED: 'شراء USDT غير متاح في بلدك.',
  USDT_AMOUNT_OUT_OF_RANGE: 'الكمية خارج الحدود المسموح بها.',
  USDT_CURRENCY_UNSUPPORTED: 'لا نبيع USDT بهذه العملة.',
  USDT_NETWORK_REQUIRED: 'اختر الشبكة.',
  USDT_NETWORK_DISABLED: 'هذه الشبكة غير متاحة حاليًا.',
  USDT_BINANCE_DISABLED: 'التحويل عبر Binance غير متاح حاليًا.',
  USDT_ADDRESS_REQUIRED: 'اكتب عنوان محفظتك.',
  USDT_ADDRESS_INVALID: 'عنوان المحفظة غير صحيح.',
  USDT_ADDRESS_CHECKSUM: 'في العنوان خطأ في حرف أو أكثر. انسخه من محفظتك مباشرة.',
  USDT_ADDRESS_WRONG_NETWORK: 'هذا العنوان من شبكة أخرى. اختر الشبكة الصحيحة أو عنوانًا آخر.',
  USDT_BINANCE_ID_REQUIRED: 'اكتب معرّف Binance.',
  USDT_BINANCE_ID_INVALID: 'معرّف Binance غير صحيح: اكتب UID (أرقام فقط) أو البريد أو الهاتف مع رمز الدولة.',
  USDT_QUOTE_CHANGED: 'تغيّر السعر. راجع المبلغ الجديد ثم أكّد.',
  USDT_TOO_MANY_OPEN: 'لديك طلبات غير مدفوعة. ادفعها أو ألغها قبل طلب جديد.',
  USDT_ORDER_NOT_FOUND: 'الطلب غير موجود.',
  USDT_INVALID_STATUS: 'لا يمكن ذلك في حالة الطلب الحالية. حدّث الصفحة.',
  USDT_ORDER_EXPIRED: 'انتهت مهلة الدفع لهذا الطلب. أنشئ طلبًا جديدًا.',
  USDT_PROOF_REQUIRED: 'أرفق صورة التحويل.',
  USDT_PAYMENT_METHOD_UNKNOWN: 'اختر إحدى وسائل الدفع المعروضة.',
  UPLOAD_TOO_LARGE: 'الصورة كبيرة جدًا.',
  UPLOAD_TYPE: 'تعذّر قبول الصورة. أرسل لقطة شاشة بصيغة JPG أو PNG.',
};

export function usdtError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.code && ERRORS[err.code]) return tNow(ERRORS[err.code]);
    if (err.status === 429) return tNow('محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.');
    return err.message || fallback;
  }
  return fallback;
}

// ─────────────── address checks, as on the server ───────────────
// The server checks again; this only tells the customer while they type.

const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];
const rotl = (x: bigint, n: number) => (n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK);

/** Ethereum's Keccak-256 of an ASCII string, as hex. */
export function keccakHex(text: string): string {
  const input = new TextEncoder().encode(text);
  const rate = 136;
  const padded = new Uint8Array(Math.floor(input.length / rate) * rate + rate);
  padded.set(input);
  padded[input.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const a = new Array<bigint>(25).fill(0n);
  const c = new Array<bigint>(5);
  const b = new Array<bigint>(25);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let k = 7; k >= 0; k--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + k]);
      a[i] ^= lane;
    }
    for (const rc of RC) {
      for (let x = 0; x < 5; x++) c[x] = a[x] ^ a[x + 5] ^ a[x + 10] ^ a[x + 15] ^ a[x + 20];
      for (let x = 0; x < 5; x++) {
        const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
        for (let y = 0; y < 25; y += 5) a[x + y] ^= d;
      }
      for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(a[x + 5 * y], ROT[x + 5 * y]);
      for (let y = 0; y < 25; y += 5) for (let x = 0; x < 5; x++) a[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y]);
      a[0] ^= rc;
    }
  }
  let hex = '';
  for (let i = 0; i < 4; i++) {
    let lane = a[i];
    for (let k = 0; k < 8; k++) {
      hex += Number(lane & 0xffn).toString(16).padStart(2, '0');
      lane >>= 8n;
    }
  }
  return hex;
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(text: string): Uint8Array | null {
  let n = 0n;
  for (const ch of text) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const BTC_RE = /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;

export type AddressCheck = { ok: true } | { ok: false; code: string; message: string };

/** Live check of a wallet address for the chosen network (same codes as the API). */
export async function checkAddress(network: UsdtNetwork, input: string): Promise<AddressCheck> {
  const a = input.trim();
  const no = (code: string, message: string, vars?: Record<string, string>): AddressCheck => ({ ok: false, code, message: tNow(message, vars) });
  if (!a) return no('USDT_ADDRESS_REQUIRED', 'اكتب عنوان محفظتك.');
  if (network === 'TRC20') {
    if (EVM_RE.test(a)) return no('USDT_ADDRESS_WRONG_NETWORK', 'هذا عنوان BEP20/ERC20 (يبدأ بـ 0x). عنوان TRC20 يبدأ بالحرف T.');
    if (BTC_RE.test(a)) return no('USDT_ADDRESS_WRONG_NETWORK', 'هذا عنوان بيتكوين وليس عنوان TRC20.');
    if (!TRON_RE.test(a)) return no('USDT_ADDRESS_INVALID', 'عنوان TRC20 يبدأ بالحرف T ويتكوّن من 34 حرفًا.');
    const raw = base58Decode(a);
    if (!raw || raw.length !== 25 || raw[0] !== 0x41) return no('USDT_ADDRESS_INVALID', 'عنوان TRC20 غير صحيح.');
    try {
      const check = (await sha256(await sha256(raw.slice(0, 21)))).slice(0, 4);
      if (check.some((v, i) => v !== raw[21 + i])) return no('USDT_ADDRESS_CHECKSUM', 'في العنوان خطأ في حرف أو أكثر. انسخه من محفظتك مباشرة.');
    } catch {
      // no Web Crypto (an old browser over plain http): the server checks it
    }
    return { ok: true };
  }
  if (TRON_RE.test(a)) return no('USDT_ADDRESS_WRONG_NETWORK', 'هذا عنوان TRC20 (يبدأ بـ T). عنوان {network} يبدأ بـ 0x.', { network });
  if (BTC_RE.test(a)) return no('USDT_ADDRESS_WRONG_NETWORK', 'هذا عنوان بيتكوين وليس عنوان USDT على هذه الشبكة.');
  if (!EVM_RE.test(a)) return no('USDT_ADDRESS_INVALID', 'العنوان يبدأ بـ 0x ثم 40 حرفًا من 0-9 وa-f.');
  const hex = a.slice(2);
  if (/^0+$/.test(hex)) return no('USDT_ADDRESS_INVALID', 'عنوان المحفظة غير صحيح.');
  if (hex !== hex.toLowerCase() && hex !== hex.toUpperCase()) {
    const hash = keccakHex(hex.toLowerCase());
    for (let i = 0; i < 40; i++) {
      const want = parseInt(hash[i], 16) >= 8 ? hex[i].toUpperCase() : hex[i].toLowerCase();
      if (hex[i] !== want) return no('USDT_ADDRESS_CHECKSUM', 'في العنوان خطأ في حرف أو أكثر. انسخه من محفظتك مباشرة.');
    }
  }
  return { ok: true };
}

/** Binance UID (digits), or the account's e-mail / phone with country code. */
export function checkBinanceId(input: string): AddressCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, code: 'USDT_BINANCE_ID_REQUIRED', message: tNow('اكتب معرّف Binance.') };
  if (/^\d{6,12}$/.test(raw)) return { ok: true };
  if (raw.includes('@') ? /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(raw) : /^\+\d{8,15}$/.test(raw.replace(/[\s-]/g, ''))) return { ok: true };
  return {
    ok: false,
    code: 'USDT_BINANCE_ID_INVALID',
    message: tNow('معرّف Binance غير صحيح: اكتب UID (أرقام فقط) أو البريد أو الهاتف مع رمز الدولة.'),
  };
}
