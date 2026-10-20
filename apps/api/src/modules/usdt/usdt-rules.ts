import { Prisma, UsdtNetwork, UsdtOrderStatus } from '@prisma/client';
import { roundMoney } from '../../common/money/money';

/** System setting holding the owner's USDT terms. */
export const USDT_CONFIG_KEY = 'usdt.config';

export const USDT_NETWORKS: UsdtNetwork[] = ['TRC20', 'BEP20', 'ERC20'];

/** Decimal values travel as strings: JSON numbers lose precision. */
export interface UsdtConfig {
  /** Off until the owner has the legal go-ahead (docs/USDT_COMPLIANCE.md). */
  enabled: boolean;
  /** Price of 1 USDT in each paying currency, e.g. { MRU: "41.5", USD: "1.03" }. */
  rates: Record<string, string>;
  /** Percentage of the subtotal, e.g. "2.5". */
  feePercent: string;
  /** A fixed fee per order, in USDT, charged at the order's rate. */
  feeFixedUsdt: string;
  minUsdt: string;
  maxUsdt: string;
  networks: Record<UsdtNetwork, boolean>;
  /** Internal Binance transfer (UID / e-mail / phone). */
  binanceEnabled: boolean;
  /** An unpaid order is cancelled after this long. */
  expiryMinutes: number;
}

export const DEFAULT_USDT_CONFIG: UsdtConfig = {
  enabled: false,
  rates: {},
  feePercent: '0',
  feeFixedUsdt: '0',
  minUsdt: '10',
  maxUsdt: '1000',
  networks: { TRC20: true, BEP20: true, ERC20: false },
  binanceEnabled: true,
  expiryMinutes: 30,
};

const DECIMAL_RE = /^\d{1,12}(\.\d{1,6})?$/;

function dec(value: unknown, fallback: string): string {
  const s = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return DECIMAL_RE.test(s) ? s : fallback;
}

/** Reads whatever is stored, filling gaps with the defaults (never enabling anything by itself). */
export function normalizeConfig(raw: unknown): UsdtConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof UsdtConfig, unknown>>;
  const nets = (r.networks && typeof r.networks === 'object' ? r.networks : {}) as Partial<Record<UsdtNetwork, unknown>>;
  const rates: Record<string, string> = {};
  if (r.rates && typeof r.rates === 'object') {
    for (const [code, v] of Object.entries(r.rates as Record<string, unknown>)) {
      const s = dec(v, '');
      if (/^[A-Z]{3}$/.test(code) && s && new Prisma.Decimal(s).gt(0)) rates[code] = s;
    }
  }
  const expiry = Number(r.expiryMinutes);
  return {
    enabled: r.enabled === true,
    rates,
    feePercent: dec(r.feePercent, DEFAULT_USDT_CONFIG.feePercent),
    feeFixedUsdt: dec(r.feeFixedUsdt, DEFAULT_USDT_CONFIG.feeFixedUsdt),
    minUsdt: dec(r.minUsdt, DEFAULT_USDT_CONFIG.minUsdt),
    maxUsdt: dec(r.maxUsdt, DEFAULT_USDT_CONFIG.maxUsdt),
    networks: {
      TRC20: typeof nets.TRC20 === 'boolean' ? nets.TRC20 : DEFAULT_USDT_CONFIG.networks.TRC20,
      BEP20: typeof nets.BEP20 === 'boolean' ? nets.BEP20 : DEFAULT_USDT_CONFIG.networks.BEP20,
      ERC20: typeof nets.ERC20 === 'boolean' ? nets.ERC20 : DEFAULT_USDT_CONFIG.networks.ERC20,
    },
    binanceEnabled: typeof r.binanceEnabled === 'boolean' ? r.binanceEnabled : DEFAULT_USDT_CONFIG.binanceEnabled,
    expiryMinutes: Number.isInteger(expiry) && expiry >= 5 && expiry <= 1440 ? expiry : DEFAULT_USDT_CONFIG.expiryMinutes,
  };
}

export interface QuoteInput {
  amountUsdt: Prisma.Decimal;
  rate: Prisma.Decimal;
  feePercent: Prisma.Decimal;
  feeFixedUsdt: Prisma.Decimal;
  /** Minor units of the paying currency (MRU 2, XOF 0); capped at the column's 4. */
  decimals: number;
}

export interface QuoteAmounts {
  subtotal: Prisma.Decimal;
  fee: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * subtotal = amount × rate; fee = subtotal × percent + fixed USDT × rate; each
 * rounded half-up to the currency's minor unit, and total = subtotal + fee, so
 * the three numbers the customer sees always add up.
 */
export function computeQuote(q: QuoteInput): QuoteAmounts {
  const places = Math.max(0, Math.min(4, q.decimals));
  const subtotal = roundMoney(q.amountUsdt.mul(q.rate), places);
  const fee = roundMoney(subtotal.mul(q.feePercent).div(100).plus(q.feeFixedUsdt.mul(q.rate)), places);
  return { subtotal, fee, total: subtotal.plus(fee) };
}

/**
 * The only moves a USDT order can make. REJECTED and CANCELLED are final, as
 * is COMPLETED. Re-submitting payment details while UNDER_REVIEW (a typo fix)
 * is an update, not a transition.
 */
const TRANSITIONS: Record<UsdtOrderStatus, UsdtOrderStatus[]> = {
  NEW: ['AWAITING_PAYMENT', 'CANCELLED'],
  AWAITING_PAYMENT: ['UNDER_REVIEW', 'CANCELLED', 'REJECTED'],
  UNDER_REVIEW: ['READY_TO_SEND', 'REJECTED'],
  // staff may still stop an approved order before sending (e.g. a doubt about the address)
  READY_TO_SEND: ['COMPLETED', 'REJECTED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canMove(from: UsdtOrderStatus, to: UsdtOrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const isFinal = (s: UsdtOrderStatus) => TRANSITIONS[s].length === 0;
