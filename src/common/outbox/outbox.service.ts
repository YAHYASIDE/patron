import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type TxClient = Prisma.TransactionClient;

/**
 * Transactional outbox.
 *
 * Enqueueing a job directly from a service is a lost-update waiting to happen:
 * if the transaction rolls back after the job was pushed, a worker processes an
 * order that does not exist; if the process dies after commit but before the
 * push, a paid order never gets fulfilled. Writing the intent to the same
 * database transaction as the state change removes both windows. A relay then
 * moves committed events onto BullMQ with at-least-once delivery — which is why
 * every processor must be idempotent.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private prisma: PrismaService) {}

  /** MUST be called with the surrounding transaction's client. */
  emit(
    tx: TxClient,
    event: { aggregate: string; aggregateId: string; eventType: string; payload: Record<string, unknown> },
  ) {
    return tx.outboxEvent.create({
      data: {
        aggregate: event.aggregate,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Claim a batch for publishing. SKIP LOCKED lets several relay instances run
   * concurrently without handing the same event to two of them.
   */
  claimBatch(limit = 100) {
    return this.prisma.$queryRaw<
      Array<{ id: string; aggregate: string; aggregateId: string; eventType: string; payload: Prisma.JsonValue; attempts: number }>
    >`
      UPDATE "outbox_events" SET "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "outbox_events"
        WHERE "status" = 'PENDING' AND "availableAt" <= NOW()
        ORDER BY "availableAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "aggregate", "aggregateId", "eventType", "payload", "attempts"
    `;
  }

  markPublished(id: string) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  /** Exponential backoff, then park in DEAD for manual inspection. */
  markFailed(id: string, attempts: number, error: string, maxAttempts = 8) {
    if (attempts >= maxAttempts) {
      this.logger.error(`Outbox event ${id} is dead after ${attempts} attempts: ${error}`);
      return this.prisma.outboxEvent.update({ where: { id }, data: { status: 'DEAD', lastError: error } });
    }
    const delayMs = Math.min(2 ** attempts * 1000, 300_000);
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PENDING', lastError: error, availableAt: new Date(Date.now() + delayMs) },
    });
  }
}
