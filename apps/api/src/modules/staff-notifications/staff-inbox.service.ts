import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { InboxState } from './dto/staff-notifications.dto';

/** The fields the dashboard and the Android admin app read (the API contract). */
const VIEW = {
  id: true, type: true, priority: true, title: true, body: true, link: true,
  createdAt: true, readAt: true, resolvedAt: true, remindCount: true,
} satisfies Prisma.StaffNotificationSelect;

const DEFAULT_LIMIT = 50;

/**
 * What one staff member sees of the shared inbox: the notices, minus the
 * types they muted. Read and resolved state is shared — when one person
 * handles a payment, it is handled for everyone.
 */
@Injectable()
export class StaffInboxService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async muted(userId: string): Promise<string[]> {
    const rows = await this.prisma.staffNotificationPref.findMany({
      where: { userId, muted: true },
      select: { type: true },
      orderBy: { type: 'asc' },
    });
    return rows.map((r) => r.type);
  }

  async list(userId: string, state: InboxState = 'open', limit = DEFAULT_LIMIT) {
    const muted = await this.muted(userId);
    const visible: Prisma.StaffNotificationWhereInput = muted.length ? { type: { notIn: muted } } : {};
    const where: Prisma.StaffNotificationWhereInput =
      state === 'open'
        ? { ...visible, resolvedAt: null }
        : state === 'resolved'
          ? { ...visible, resolvedAt: { not: null } }
          : visible;

    const [data, unread, open] = await Promise.all([
      this.prisma.staffNotification.findMany({
        where,
        // what needs a person now first: URGENT, then HIGH…; the newest within each
        orderBy: state === 'open' ? [{ priority: 'desc' }, { createdAt: 'desc' }] : [{ createdAt: 'desc' }],
        take: limit,
        select: VIEW,
      }),
      this.prisma.staffNotification.count({ where: { ...visible, resolvedAt: null, readAt: null } }),
      this.prisma.staffNotification.count({ where: { ...visible, resolvedAt: null } }),
    ]);
    return { data, unread, open };
  }

  private async find(id: string) {
    const row = await this.prisma.staffNotification.findUnique({ where: { id }, select: { id: true } });
    if (!row) throw new NotFoundException({ message: 'Notification not found', error: 'STAFF_NOTIFICATION_NOT_FOUND' });
  }

  async markRead(id: string, userId: string) {
    await this.find(id);
    // the first reader is kept: reading it again changes nothing
    await this.prisma.staffNotification.updateMany({ where: { id, readAt: null }, data: { readAt: new Date(), readById: userId } });
    return this.prisma.staffNotification.findUniqueOrThrow({ where: { id }, select: VIEW });
  }

  /** Marks what this person can see as read; muted types stay as they are for the others. */
  async readAll(userId: string) {
    const muted = await this.muted(userId);
    const { count } = await this.prisma.staffNotification.updateMany({
      where: { readAt: null, ...(muted.length && { type: { notIn: muted } }) },
      data: { readAt: new Date(), readById: userId },
    });
    return { updated: count };
  }

  /** A person says it is dealt with; it also counts as read. */
  async resolve(id: string, userId: string) {
    await this.find(id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.staffNotification.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: now } });
      await tx.staffNotification.updateMany({ where: { id, readAt: null }, data: { readAt: now, readById: userId } });
      if (count) await this.audit.record(tx, { actorId: userId, action: 'staff_notifications.resolve', entityType: 'StaffNotification', entityId: id });
    });
    return this.prisma.staffNotification.findUniqueOrThrow({ where: { id }, select: VIEW });
  }

  async prefs(userId: string) {
    return { muted: await this.muted(userId) };
  }

  /** Replaces this person's muted types with the given list. */
  async setPrefs(userId: string, muted: string[]) {
    const types = [...new Set(muted)].sort();
    const before = await this.muted(userId);
    await this.prisma.$transaction(async (tx) => {
      await tx.staffNotificationPref.deleteMany({ where: { userId } });
      if (types.length) await tx.staffNotificationPref.createMany({ data: types.map((type) => ({ userId, type, muted: true })) });
      await this.audit.record(tx, {
        actorId: userId, action: 'staff_notifications.prefs', entityType: 'User', entityId: userId,
        before: { muted: before }, after: { muted: types },
      });
    });
    return { muted: types };
  }
}
