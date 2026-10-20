import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StaffPriority } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface StaffNotice {
  /** order.paid, payment.pending, order.failed, refund.requested, support.message, system.error, backup.failed, usdt.new, bank.unmatched… */
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
}
