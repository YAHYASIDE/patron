import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, WalletTxnType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TxClient } from '../../common/outbox/outbox.service';
import { D } from '../../common/money/money';
import { LockRank, acquireLocks } from '../../common/locking/lock-order';

interface LedgerEntry {
  userId: string;
  currency: string;
  amount: Prisma.Decimal | number; // signed: credit +, debit −
  type: WalletTxnType;
  referenceType?: string;
  referenceId?: string;
  description?: string;
  createdById?: string;
}

/**
 * Wallets are a ledger, not a counter.
 *
 * `wallets.balance` is a cached projection; `wallet_transactions` is the truth.
 * Every mutation takes a row lock (SELECT ... FOR UPDATE) before reading the
 * balance, because the read-modify-write is otherwise a textbook lost update:
 * two concurrent debits both read 100, both write 50, and 50 is spent twice.
 */
@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}

  async getOrCreate(userId: string, currency: string, tx?: TxClient) {
    const client = tx ?? this.prisma;
    const existing = await client.wallet.findUnique({
      where: { userId_currencyCode: { userId, currencyCode: currency } },
    });
    if (existing) return existing;

    return client.wallet.create({ data: { userId, currencyCode: currency } });
  }

  listForUser(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      include: { currency: { select: { code: true, symbol: true, decimals: true } } },
    });
  }

  async history(userId: string, currency?: string, take = 50) {
    return this.prisma.walletTransaction.findMany({
      where: { userId, ...(currency && { currency }) },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /**
   * Apply a signed ledger entry. MUST run inside a transaction when it is part
   * of a larger operation (paying for an order), so the debit and the order
   * state change commit together or not at all.
   */
  async post(entry: LedgerEntry, tx: TxClient): Promise<{ balanceAfter: Prisma.Decimal }> {
    const wallet = await this.getOrCreate(entry.userId, entry.currency, tx);

    // Serialise concurrent mutations of this wallet. Wallet is rank 1 in the
    // global lock order (ADR 010), so taking it here is always safe.
    await acquireLocks(tx, [{ rank: LockRank.WALLET, id: wallet.id }]);

    const locked = await tx.wallet.findUniqueOrThrow({
      where: { id: wallet.id },
      select: { balance: true },
    });
    const balanceBefore = D(locked.balance);
    const amount = D(entry.amount);
    const balanceAfter = balanceBefore.plus(amount);

    if (balanceAfter.lt(0)) {
      throw new BadRequestException(
        `Insufficient wallet balance: ${balanceBefore} ${entry.currency} available`,
      );
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter, version: { increment: 1 } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        userId: entry.userId,
        type: entry.type,
        amount,
        balanceBefore,
        balanceAfter,
        currency: entry.currency,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        createdById: entry.createdById,
      },
    });

    return { balanceAfter };
  }

  debit(entry: Omit<LedgerEntry, 'amount'> & { amount: Prisma.Decimal | number }, tx: TxClient) {
    return this.post({ ...entry, amount: D(entry.amount).neg() }, tx);
  }

  credit(entry: Omit<LedgerEntry, 'amount'> & { amount: Prisma.Decimal | number }, tx: TxClient) {
    return this.post({ ...entry, amount: D(entry.amount) }, tx);
  }

  /**
   * Take the wallet lock *before* the caller touches an order, payment or
   * refund row. Required by callers whose natural read order would otherwise
   * violate the global ordering — see RefundsService.process.
   *
   * Returns the wallet so the caller does not have to look it up twice.
   */
  async lockWallet(userId: string, currency: string, tx: TxClient) {
    const wallet = await this.getOrCreate(userId, currency, tx);
    await acquireLocks(tx, [{ rank: LockRank.WALLET, id: wallet.id }]);
    return wallet;
  }

  /** Admin adjustment — always audited, never silent. */
  async adjust(userId: string, currency: string, amount: number, reason: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.post(
        {
          userId, currency, amount,
          type: WalletTxnType.ADMIN_ADJUSTMENT,
          description: reason,
          createdById: actorId,
        },
        tx,
      );
      await tx.auditLog.create({
        data: {
          userId: actorId, action: 'wallet.adjust', entityType: 'Wallet', entityId: userId,
          after: { amount, currency, reason } as any,
        },
      });
      return result;
    });
  }

  /**
   * Reconciliation: the cached balance must equal the ledger sum. A mismatch
   * means a write bypassed post(), which is a bug, not a data-fix.
   *
   * Scoped to wallets touched since `since` by default. The unscoped version
   * aggregates every ledger row ever written — fine at ten thousand wallets,
   * a multi-minute table scan at a hundred thousand. The nightly job checks
   * the last 48 hours; a full sweep is a weekly job.
   */
  async findDrift(since?: Date) {
    const cutoff = since ?? new Date(Date.now() - 48 * 3_600_000);

    return this.prisma.$queryRaw<Array<{ walletId: string; cached: string; ledger: string }>>`
      WITH touched AS (
        SELECT DISTINCT "walletId" FROM "wallet_transactions" WHERE "createdAt" >= ${cutoff}
      )
      SELECT w."id" AS "walletId",
             w."balance"::text AS cached,
             COALESCE(SUM(t."amount"), 0)::text AS ledger
      FROM "wallets" w
      JOIN touched ON touched."walletId" = w."id"
      LEFT JOIN "wallet_transactions" t ON t."walletId" = w."id"
      GROUP BY w."id", w."balance"
      HAVING w."balance" <> COALESCE(SUM(t."amount"), 0)
    `;
  }

  /** Full sweep — weekly, off-peak. */
  findDriftFull() {
    return this.findDrift(new Date(0));
  }
}
