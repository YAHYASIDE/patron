import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TxClient } from '../locking/lock-order';
import { RequestContextStore } from '../context/request-context';

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  actorId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Normalise an arbitrary value into something Prisma will accept for a `Json?`
 * column, redacting secrets on the way through.
 *
 * Exported because several services still write `auditLog` directly. Those
 * call sites previously cast to `any`, which silently defeated both the type
 * check and the redaction — a before/after snapshot of a User row would carry
 * its passwordHash straight into a table that report readers can query.
 *
 * Prisma's `InputJsonValue` does not include Date or Decimal, which is why the
 * JSON round-trip is required rather than a cast: it converts both to strings.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;

  const SENSITIVE = /passwordHash|Enc$|twoFaSecret|tokenHash|codeHash/i;

  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([k, v]) => [
          k,
          SENSITIVE.test(k) ? '[REDACTED]' : walk(v),
        ]),
      );
    }
    return input;
  };

  return JSON.parse(JSON.stringify(walk(value))) as Prisma.InputJsonValue;
}

/**
 * Audit writes were duplicated across eight services, each spelling the same
 * `prisma.auditLog.create` slightly differently — some captured the IP, some
 * did not, some forgot the actor. Centralising it means the shape is uniform
 * and the request context (ip, user agent, correlation id) is attached
 * automatically rather than by whoever remembered.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  /** Inside a transaction — the audit row commits with the change it records. */
  record(tx: TxClient, entry: AuditEntry) {
    return tx.auditLog.create({ data: this.build(entry) });
  }

  /**
   * Outside a transaction. Fire-and-forget: a failed audit write must not fail
   * the operation it describes, but it must be loud.
   */
  async recordAsync(entry: AuditEntry) {
    try {
      await this.prisma.auditLog.create({ data: this.build(entry) });
    } catch (err) {
      this.logger.error(`Failed to write audit entry ${entry.action}: ${(err as Error).message}`);
    }
  }

  private build(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    const ctx = RequestContextStore.get();
    return {
      userId: entry.actorId ?? ctx?.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: this.redact(entry.before),
      after: this.redact(entry.after),
      ipAddress: ctx?.ip,
    };
  }

  /**
   * Audit rows are frequently before/after snapshots of whole records, which
   * is exactly how a password hash or an encrypted provider key ends up
   * readable to anyone with report access.
   */
  private redact(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    return toAuditJson(value);
  }
}
