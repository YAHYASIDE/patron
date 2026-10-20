import { CommissionStatus, Prisma } from '@prisma/client';

import { D, ZERO } from '../../common/money/money';

/** One row of `commission.groupBy({ by: ['status'] })` with the sums the statement needs. */
export interface StatusGroup {
  status: CommissionStatus;
  _count: { _all: number };
  _sum: {
    amount: Prisma.Decimal | null;
    clawbackAmount: Prisma.Decimal | null;
    clawbackRecovered: Prisma.Decimal | null;
  };
}

export interface Statement {
  currency: string;
  pending: { count: number; amount: string };
  earned: { count: number; amount: string };
  paid: { count: number; amount: string };
  void: { count: number; amount: string };
  clawback: { total: string; recovered: string; open: string };
  payouts: { count: number; total: string };
  /** What the shop owes the agent now: earned and unpaid, less clawbacks not yet recovered. Negative = the agent owes. */
  balanceDue: string;
}

const money = (v: Prisma.Decimal) => v.toFixed(2);

/**
 * An agent's account at a glance. Paid commissions keep their paid amount; a
 * refund after payout shows as a clawback, and the clawbacks still open come
 * off the balance (and off the next payout).
 */
export function buildStatement(
  groups: StatusGroup[],
  payouts: { count: number; total: Prisma.Decimal | null },
  currency: string,
): Statement {
  const by = (s: CommissionStatus) => groups.find((g) => g.status === s);
  const part = (s: CommissionStatus) => ({
    count: by(s)?._count._all ?? 0,
    amount: money(D(by(s)?._sum.amount ?? 0)),
  });
  const clawTotal = groups.reduce((a, g) => a.plus(D(g._sum.clawbackAmount ?? 0)), ZERO());
  const clawRecovered = groups.reduce((a, g) => a.plus(D(g._sum.clawbackRecovered ?? 0)), ZERO());
  const open = Prisma.Decimal.max(clawTotal.minus(clawRecovered), 0);
  const earned = D(by('EARNED')?._sum.amount ?? 0);

  return {
    currency,
    pending: part('PENDING'),
    earned: part('EARNED'),
    paid: part('PAID'),
    void: part('VOID'),
    clawback: { total: money(clawTotal), recovered: money(clawRecovered), open: money(open) },
    payouts: { count: payouts.count, total: money(D(payouts.total ?? 0)) },
    balanceDue: money(earned.minus(open)),
  };
}

/**
 * How much of the open clawbacks a payout of `gross` takes off, oldest first,
 * never more than the payout itself. Returns the per-commission recovery.
 */
export function allocateClawbacks(
  gross: Prisma.Decimal,
  open: Array<{ id: string; clawbackAmount: Prisma.Decimal | null; clawbackRecovered: Prisma.Decimal | null }>,
): { deducted: Prisma.Decimal; recoveries: Array<{ id: string; recovered: Prisma.Decimal }> } {
  let room = gross;
  const recoveries: Array<{ id: string; recovered: Prisma.Decimal }> = [];
  for (const c of open) {
    if (room.lte(0)) break;
    const recovered = D(c.clawbackRecovered ?? 0);
    const left = D(c.clawbackAmount ?? 0).minus(recovered);
    if (left.lte(0)) continue;
    const take = Prisma.Decimal.min(left, room);
    recoveries.push({ id: c.id, recovered: recovered.plus(take) });
    room = room.minus(take);
  }
  return { deducted: gross.minus(room), recoveries };
}
