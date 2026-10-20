import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StaffPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface StaffNotice {
  /** order.new, payment.pending, order.failed, refund.pending, support.message, system.error, backup.failed, usdt.new, bank.unmatched… */
  type: string;
  priority?: StaffPriority;
  /** Arabic: the owner reads it. */
  title: string;
  body: string;
  /** Dashboard path to open, e.g. /orders/<id>. */
  link?: string;
  data?: Prisma.InputJsonValue;
  /** One live notice per subject: `order.failed:<orderId>`. Defaults to type + entity. */
  dedupeKey?: string;
  entityType?: string;
  entityId?: string;
}

/** Reminders: an open notice of these priorities is raised again after this long… */
export const REMIND_AFTER_MIN: Partial<Record<StaffPriority, number>> = { URGENT: 15, HIGH: 30 };
/** …at most this many times, so a notice nobody can act on does not ring forever. */
export const MAX_REMINDERS = 6;

/**
 * The owner's inbox. Any module calls `notify()` when something needs a person;
 * the same subject never stacks up: a second notice with the same dedupeKey
 * refreshes the first (and reopens it if it had been resolved) instead of adding
 * a row. `resolve()` closes it once the thing is dealt with.
 */
@Injectable()
export class StaffNotificationsService {
  private readonly log = new Logger(StaffNotificationsService.name);

  constructor(private prisma: PrismaService) {}

  static key(n: Pick<StaffNotice, 'type' | 'dedupeKey' | 'entityId'>) {
    return n.dedupeKey ?? (n.entityId ? `${n.type}:${n.entityId}` : `${n.type}:${Date.now()}`);
  }

  /** Never throws: a notice must not break the money path that raised it. */
  async notify(n: StaffNotice, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const dedupeKey = StaffNotificationsService.key(n);
    const fields = {
      type: n.type,
      priority: n.priority ?? 'NORMAL',
      title: n.title,
      body: n.body,
      link: n.link ?? null,
      data: n.data ?? Prisma.JsonNull,
      entityType: n.entityType ?? null,
      entityId: n.entityId ?? null,
    };
    try {
      // A resolved subject that comes back (an order failing again after a
      // retry) is a new problem: it starts fresh, with its own reminders.
      await db.staffNotification.updateMany({
        where: { dedupeKey, resolvedAt: { not: null } },
        data: { createdAt: new Date(), remindCount: 0, lastRemindedAt: null },
      });
      return await db.staffNotification.upsert({
        where: { dedupeKey },
        create: { ...fields, dedupeKey },
        update: { ...fields, resolvedAt: null, readAt: null, readById: null },
      });
    } catch (e) {
      this.log.warn(`staff notice ${dedupeKey} not stored: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** The subject was dealt with (order delivered, payment reviewed…): close its notice. */
  async resolve(dedupeKey: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    await db.staffNotification.updateMany({ where: { dedupeKey, resolvedAt: null }, data: { resolvedAt: new Date() } });
  }

  /**
   * Close every open notice about one subject (an order cancelled or refunded
   * closes its delivery, failure and transfer notices at once). Never throws.
   */
  async resolveFor(entityType: string, entityId: string, types?: string[]) {
    try {
      const { count } = await this.prisma.staffNotification.updateMany({
        where: { entityType, entityId, resolvedAt: null, ...(types && { type: { in: types } }) },
        data: { resolvedAt: new Date() },
      });
      return count;
    } catch (e) {
      this.log.warn(`staff notices for ${entityType} ${entityId} not resolved: ${e instanceof Error ? e.message : e}`);
      return 0;
    }
  }

  /**
   * The repeatable reminder sweep: an open URGENT notice older than 15 minutes
   * (HIGH: 30) since it was raised or last reminded rings again — unread, with
   * remindCount bumped — at most MAX_REMINDERS times. It updates the row in
   * place, so a reminder never adds a second notice. Safe to run twice.
   */
  async remind(now = new Date()) {
    let reminded = 0;
    for (const [priority, minutes] of Object.entries(REMIND_AFTER_MIN) as Array<[StaffPriority, number]>) {
      const due = new Date(now.getTime() - minutes * 60_000);
      const { count } = await this.prisma.staffNotification.updateMany({
        where: {
          priority,
          resolvedAt: null,
          remindCount: { lt: MAX_REMINDERS },
          OR: [{ lastRemindedAt: null, createdAt: { lte: due } }, { lastRemindedAt: { lte: due } }],
        },
        data: { remindCount: { increment: 1 }, lastRemindedAt: now, readAt: null, readById: null },
      });
      reminded += count;
    }
    if (reminded) this.log.log(`Reminded ${reminded} open staff notice(s)`);
    return reminded;
  }
}
