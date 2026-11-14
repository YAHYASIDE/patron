import { randomInt } from 'crypto';
import { CommissionStatus, CommissionType, OrderStatus, Prisma } from '@prisma/client';

import { D, ZERO } from '../../common/money/money';

/**
 * The commission rules, kept free of the database so every case can be tested
 * on its own. The service (commissions.service.ts) loads the facts, asks these
 * functions what the commission should be, and writes the answer.
 */

/** The rule frozen on a commission when it is created: later rule edits never touch it. */
export interface CommissionRule {
  type: CommissionType;
  value: string;
}

export type VoidReason = 'order_cancelled' | 'order_failed' | 'order_refunded';

/** What the order's current state says the commission should be. */
export type Target =
  | { status: 'NONE' }
  | { status: 'PENDING' | 'EARNED' }
  | { status: 'VOID'; reason: VoidReason };

/** Base-currency value left after processed refunds, never below zero. */
export function netValue(totalBase: Prisma.Decimal.Value, refundedBase: Prisma.Decimal.Value | null | undefined) {
  const net = D(totalBase).minus(D(refundedBase ?? 0));
  return net.lt(0) ? ZERO() : net;
}

/**
 * PERCENT: that percent of the net value, to the cent. FIXED: the amount per
 * order, but never more than the order is still worth (a refunded-down order
 * cannot pay its agent more than it brought in).
 */
export function commissionAmount(rule: CommissionRule, net: Prisma.Decimal): Prisma.Decimal {
  if (net.lte(0)) return ZERO();
  const value = D(rule.value);
  if (value.lte(0)) return ZERO();
  if (rule.type === 'PERCENT') {
    return net.mul(value).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }
  return Prisma.Decimal.min(value, net).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Earned only once the order is COMPLETED. Paid but not yet delivered (or
 * delivered in part) is PENDING. Cancelled, failed or refunded down to nothing
 * is VOID. An unpaid order has no commission at all.
 */
export function targetFor(status: OrderStatus, net: Prisma.Decimal): Target {
  switch (status) {
    case 'PENDING_PAYMENT':
      return { status: 'NONE' };
    case 'CANCELLED':
      return { status: 'VOID', reason: 'order_cancelled' };
    case 'FAILED':
      return { status: 'VOID', reason: 'order_failed' };
    case 'REFUNDED':
      return { status: 'VOID', reason: 'order_refunded' };
    default:
      break;
  }
  if (net.lte(0)) return { status: 'VOID', reason: 'order_refunded' };
  return status === 'COMPLETED' ? { status: 'EARNED' } : { status: 'PENDING' };
}

export interface ExistingCommission {
  status: CommissionStatus;
  amount: Prisma.Decimal;
  basis: Prisma.Decimal;
  voidReason: string | null;
  clawbackAmount: Prisma.Decimal | null;
}

/** The single change (if any) to apply to the commission row. */
export type Plan =
  | { kind: 'noop' }
  | { kind: 'create'; status: 'PENDING' | 'EARNED'; basis: Prisma.Decimal; amount: Prisma.Decimal }
  | {
      kind: 'update';
      status: 'PENDING' | 'EARNED' | 'VOID';
      basis: Prisma.Decimal;
      amount: Prisma.Decimal;
      voidReason: VoidReason | null;
    }
  /** Already PAID: the paid row stays as it is; what the agent owes back grows to `clawbackAmount`. */
  | { kind: 'clawback'; clawbackAmount: Prisma.Decimal; reason: VoidReason | 'partial_refund'; basis: Prisma.Decimal };

/**
 * Decide what to do, from the facts alone. Idempotent: run twice on the same
 * facts, the second run is a noop — which is what makes out-of-order and
 * repeated outbox events harmless.
 */
export function plan(
  existing: ExistingCommission | null,
  target: Target,
  rule: CommissionRule,
  net: Prisma.Decimal,
): Plan {
  if (!existing) {
    if (target.status === 'PENDING' || target.status === 'EARNED') {
      return { kind: 'create', status: target.status, basis: net, amount: commissionAmount(rule, net) };
    }
    // nothing was ever owed for an order that never got going
    return { kind: 'noop' };
  }

  if (existing.status === 'PAID') {
    // paid history is never rewritten: the difference becomes a visible clawback
    const shouldBe = target.status === 'VOID' ? ZERO() : commissionAmount(rule, net);
    const owed = existing.amount.minus(shouldBe);
    const already = existing.clawbackAmount ?? ZERO();
    if (owed.lte(already)) return { kind: 'noop' };
    return {
      kind: 'clawback',
      clawbackAmount: owed,
      reason: target.status === 'VOID' ? target.reason : 'partial_refund',
      basis: net,
    };
  }

  if (target.status === 'NONE') return { kind: 'noop' };

  const amount = commissionAmount(rule, net);
  const voidReason = target.status === 'VOID' ? target.reason : null;
  if (
    existing.status === target.status &&
    existing.amount.eq(amount) &&
    existing.basis.eq(net) &&
    (existing.voidReason ?? null) === voidReason
  ) {
    return { kind: 'noop' };
  }
  return { kind: 'update', status: target.status, basis: net, amount, voidReason };
}

// ── Referral codes ──

/** No 0/O, 1/I/L: a code read out over the phone or typed from a screenshot survives. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_PATTERN = /^[A-Z0-9]{4,12}$/;

export function generateCode(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** What the customer typed or the link carried, upper-cased; null when it cannot be a code. */
export function normalizeCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}

// ── What an agent may see of a customer ──

/** "+22222123456" → "+222 •••• 56": enough to recognise, not enough to call. */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '••••';
  const cc = digits.length > 8 ? digits.slice(0, digits.length - 8) : '';
  return `${cc ? `+${cc} ` : ''}•••• ${digits.slice(-2)}`;
}

/** First name only. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? '';
}
