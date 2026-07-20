import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Data retention.
 *
 * Six tables grow without bound and none of them were being pruned: outbox
 * events, provider calls, audit logs, login attempts, notifications and
 * verification tokens. At a million orders these dominate the database — and
 * more importantly, they slow down the queries that share their indexes.
 *
 * Deletes are chunked. A single `DELETE FROM provider_calls WHERE createdAt <
 * ...` matching two million rows takes an ACCESS EXCLUSIVE-adjacent lock long
 * enough to stall writes, and generates a WAL spike that can fill the disk.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  /** Days to keep. Financial records are excluded — those are kept forever. */
  private static readonly POLICY = {
    outboxPublished: 7,
    providerCalls: 180,   // long enough to cover a provider billing dispute
    auditLogs: 730,       // 2 years — regulatory
    loginAttempts: 30,
    notifications: 90,
    verificationTokens: 7,
    refreshTokensRevoked: 30,
    idempotencyRecords: 1,
  } as const;

  private static readonly CHUNK = 5_000;

  constructor(private prisma: PrismaService) {}

  async runAll() {
    const results: Record<string, number> = {};
    for (const [name, fn] of Object.entries(this.tasks())) {
      try {
        results[name] = await fn();
      } catch (err) {
        this.logger.error(`Retention task "${name}" failed: ${(err as Error).message}`);
        results[name] = -1;
      }
    }
    this.logger.log(`Retention complete: ${JSON.stringify(results)}`);
    return results;
  }

  private tasks() {
    return {
      // DEAD events are never pruned: they represent work that was committed
      // and never done, and someone has to look at them.
      outbox: () => this.pruneOutbox(RetentionService.POLICY.outboxPublished),

      providerCalls: () =>
        this.chunkedDeleteRaw('provider_calls', 'createdAt', RetentionService.POLICY.providerCalls),

      auditLogs: () =>
        this.chunkedDeleteRaw('audit_logs', 'createdAt', RetentionService.POLICY.auditLogs),

      loginAttempts: () =>
        this.chunkedDeleteRaw('login_attempts', 'createdAt', RetentionService.POLICY.loginAttempts),

      notifications: () =>
        this.chunkedDeleteRaw('notifications', 'createdAt', RetentionService.POLICY.notifications),

      verificationTokens: () =>
        this.chunkedDeleteRaw('verification_tokens', 'expiresAt', RetentionService.POLICY.verificationTokens),

      refreshTokens: () =>
        this.chunkedDeleteRaw('refresh_tokens', 'expiresAt', RetentionService.POLICY.refreshTokensRevoked),

      idempotency: () =>
        this.chunkedDeleteRaw('idempotency_records', 'expiresAt', RetentionService.POLICY.idempotencyRecords),
    };
  }

  /**
   * Delete in bounded chunks using a CTE, yielding between batches so the
   * sweeper never becomes the reason writes are slow.
   */
  private async chunkedDeleteRaw(table: string, column: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 864e5);
    let deleted = 0;

    for (;;) {
      const rows = await this.prisma.$executeRawUnsafe(
        `
        WITH doomed AS (
          SELECT ctid FROM "${table}"
          WHERE "${column}" < $1
          LIMIT ${RetentionService.CHUNK}
        )
        DELETE FROM "${table}" t USING doomed d WHERE t.ctid = d.ctid
        `,
        cutoff,
      );
      deleted += rows;
      if (rows < RetentionService.CHUNK) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return deleted;
  }

  private async pruneOutbox(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 864e5);
    let deleted = 0;

    for (;;) {
      const batch = await this.prisma.outboxEvent.findMany({
        where: { status: 'PUBLISHED', publishedAt: { lt: cutoff } },
        select: { id: true },
        take: RetentionService.CHUNK,
      });
      if (batch.length === 0) break;

      const { count } = await this.prisma.outboxEvent.deleteMany({
        where: { id: { in: batch.map((e) => e.id) } },
      });
      deleted += count;
      if (batch.length < RetentionService.CHUNK) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return deleted;
  }

  /**
   * Table sizes, so growth is observed rather than discovered when the disk
   * fills at 2am.
   */
  tableSizes() {
    return this.prisma.$queryRaw<Array<{ table: string; rows: bigint; size: string }>>`
      SELECT c.relname AS table,
             c.reltuples::bigint AS rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 25
    `;
  }
}
