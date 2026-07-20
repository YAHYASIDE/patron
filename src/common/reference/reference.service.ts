import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TxClient } from '../locking/lock-order';

/**
 * Human-facing reference numbers (PTN-20260723-00000123).
 *
 * Previously a random 8-character suffix. At 1M orders that is a birthday
 * problem, not a theoretical one: random suffixes collide, the unique index
 * rejects the insert, and a customer's checkout fails for a reason they could
 * never understand and support could never reproduce.
 *
 * A database sequence is collision-free by construction, monotonic (so support
 * can tell which of two orders came first), and costs one cheap call.
 */
@Injectable()
export class ReferenceService {
  constructor(private prisma: PrismaService) {}

  order(tx?: TxClient) {
    return this.next('order_number_seq', 'PTN', tx);
  }

  quote(tx?: TxClient) {
    return this.next('quote_number_seq', 'QT', tx);
  }

  refund(tx?: TxClient) {
    return this.next('refund_number_seq', 'RF', tx);
  }

  private async next(sequence: string, prefix: string, tx?: TxClient): Promise<string> {
    const client = tx ?? this.prisma;
    // Sequence name comes from this file's own literals, never caller input.
    const [row] = await client.$queryRawUnsafe<Array<{ nextval: bigint }>>(
      `SELECT nextval('${sequence}') AS nextval`,
    );

    const d = new Date();
    const stamp =
      `${d.getUTCFullYear()}` +
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
      `${String(d.getUTCDate()).padStart(2, '0')}`;

    return `${prefix}-${stamp}-${String(row.nextval).padStart(8, '0')}`;
  }
}
