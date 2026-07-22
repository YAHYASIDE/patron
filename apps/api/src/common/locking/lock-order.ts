import { Prisma } from '@prisma/client';

/**
 * Global lock acquisition order — see ADR 010.
 *
 * Deadlocks happen when two transactions take the same locks in opposite
 * orders. Every code path that locks more than one row MUST acquire in this
 * order, regardless of the order the business logic would naturally read them.
 *
 *   wallet → order → payment → refund
 *
 * If you add a path that locks rows in more than one of these tables, extend
 * this enum rather than inventing a local ordering.
 */
export enum LockRank {
  WALLET = 1,
  ORDER = 2,
  PAYMENT = 3,
  REFUND = 4,
}

const TABLE_BY_RANK: Record<LockRank, string> = {
  [LockRank.WALLET]: 'wallets',
  [LockRank.ORDER]: 'orders',
  [LockRank.PAYMENT]: 'payments',
  [LockRank.REFUND]: 'refunds',
};

export type TxClient = Prisma.TransactionClient;

/**
 * Acquire row locks in the canonical order.
 *
 * Sorting by rank inside this helper means callers cannot get the order wrong
 * even if they list the resources in whatever sequence reads most naturally.
 * Ids are sorted within a rank too: two transactions locking the same *pair* of
 * wallets would otherwise still be able to deadlock against each other.
 */
export async function acquireLocks(
  tx: TxClient,
  resources: Array<{ rank: LockRank; id: string }>,
): Promise<void> {
  const ordered = [...resources].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));

  for (const resource of ordered) {
    const table = TABLE_BY_RANK[resource.rank];
    // Table name comes from the enum map, never from a caller-supplied string.
    await tx.$queryRawUnsafe(`SELECT "id" FROM "${table}" WHERE "id" = $1::uuid FOR UPDATE`, resource.id);
  }
}

/** Convenience for the common single-resource case. */
export function lock(rank: LockRank, id: string) {
  return { rank, id };
}
