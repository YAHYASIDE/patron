import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';

const TTL_HOURS = 24;
const LOCK_TIMEOUT_MS = 60_000;

interface Replay {
  replayed: true;
  statusCode: number;
  body: unknown;
}

/**
 * Request-level deduplication for money-moving endpoints.
 *
 * Mobile clients retry aggressively on flaky networks. Without this, a retried
 * checkout charges twice. The unique primary key on `key` makes the claim
 * atomic — two concurrent requests race, one wins, the other is told to wait.
 */
@Injectable()
export class IdempotencyService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  hashRequest(body: unknown): string {
    return this.crypto.sha256(JSON.stringify(body ?? {}));
  }

  /**
   * @returns a completed response to replay, or null when the caller should
   *          proceed and later call `complete()`.
   */
  async claim(key: string, endpoint: string, requestHash: string, userId?: string): Promise<Replay | null> {
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { key } });

    if (existing) {
      // Same key, different payload — a client bug, not a retry.
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency-Key was reused with a different request body');
      }
      if (existing.completedAt) {
        return { replayed: true, statusCode: existing.statusCode ?? 200, body: existing.responseBody };
      }
      // In flight. A stale lock means the previous attempt crashed.
      const stale = existing.lockedAt && Date.now() - existing.lockedAt.getTime() > LOCK_TIMEOUT_MS;
      if (!stale) throw new ConflictException('A request with this Idempotency-Key is still in progress');

      await this.prisma.idempotencyRecord.update({ where: { key }, data: { lockedAt: new Date() } });
      return null;
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          key,
          userId,
          endpoint,
          requestHash,
          lockedAt: new Date(),
          expiresAt: new Date(Date.now() + TTL_HOURS * 3_600_000),
        },
      });
      return null;
    } catch (e) {
      // Lost the race to a concurrent identical request.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A request with this Idempotency-Key is still in progress');
      }
      throw e;
    }
  }

  complete(key: string, statusCode: number, body: unknown) {
    return this.prisma.idempotencyRecord.update({
      where: { key },
      data: { statusCode, responseBody: body as Prisma.InputJsonValue, completedAt: new Date(), lockedAt: null },
    });
  }

  /** Release on failure so the client can legitimately retry. */
  release(key: string) {
    return this.prisma.idempotencyRecord.deleteMany({ where: { key, completedAt: null } });
  }

  purgeExpired() {
    return this.prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
