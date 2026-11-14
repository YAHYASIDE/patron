import { MAX_REMINDERS, StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import {
  STAFF_REMIND_JOB, StaffRemindersProcessor,
} from '../../src/modules/staff-notifications/staff-reminders.processor';

describe('StaffNotificationsService', () => {
  let prisma: any;
  let service: StaffNotificationsService;

  beforeEach(() => {
    prisma = {
      staffNotification: {
        upsert: jest.fn((a: any) => Promise.resolve({ id: 'n1', ...a.create })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new StaffNotificationsService(prisma);
  });

  describe('notify', () => {
    it('keeps one row per subject: an upsert on the dedupe key that reopens and marks unread', async () => {
      await service.notify({ type: 'order.failed', priority: 'URGENT', title: 'فشل', body: 'x', dedupeKey: 'order.failed:o1' });
      const args = prisma.staffNotification.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ dedupeKey: 'order.failed:o1' });
      expect(args.create).toMatchObject({ type: 'order.failed', priority: 'URGENT', dedupeKey: 'order.failed:o1' });
      expect(args.update).toMatchObject({ resolvedAt: null, readAt: null, readById: null });
    });

    it('a resolved subject that comes back starts fresh: new createdAt, reminders reset', async () => {
      await service.notify({ type: 'order.failed', title: 't', body: 'b', entityId: 'o1' });
      const reset = prisma.staffNotification.updateMany.mock.calls[0][0];
      expect(reset.where).toEqual({ dedupeKey: 'order.failed:o1', resolvedAt: { not: null } });
      expect(reset.data).toMatchObject({ remindCount: 0, lastRemindedAt: null, createdAt: expect.any(Date) });
    });

    it('defaults the priority to NORMAL and uses a transaction client when given one', async () => {
      const tx = { staffNotification: { upsert: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
      await service.notify({ type: 'support.message', title: 't', body: 'b', dedupeKey: 'k' }, tx as any);
      expect(tx.staffNotification.upsert.mock.calls[0][0].create.priority).toBe('NORMAL');
      expect(prisma.staffNotification.upsert).not.toHaveBeenCalled();
    });

    it('never throws: a notice must not break the path that raised it', async () => {
      prisma.staffNotification.upsert.mockRejectedValueOnce(new Error('db down'));
      await expect(service.notify({ type: 'x.y', title: 't', body: 'b', dedupeKey: 'k' })).resolves.toBeNull();
    });

    it('builds a key from the type and entity, or a unique one without an entity', () => {
      expect(StaffNotificationsService.key({ type: 'a.b', entityId: 'e' })).toBe('a.b:e');
      expect(StaffNotificationsService.key({ type: 'a.b', dedupeKey: 'k' })).toBe('k');
      expect(StaffNotificationsService.key({ type: 'a.b' })).toMatch(/^a\.b:\d+$/);
    });
  });

  describe('resolve', () => {
    it('closes only the open notice with that key', async () => {
      await service.resolve('payment.pending:p1');
      expect(prisma.staffNotification.updateMany).toHaveBeenCalledWith({
        where: { dedupeKey: 'payment.pending:p1', resolvedAt: null },
        data: { resolvedAt: expect.any(Date) },
      });
    });

    it('closes every open notice of a subject, optionally only some types', async () => {
      prisma.staffNotification.updateMany.mockResolvedValueOnce({ count: 3 });
      expect(await service.resolveFor('Order', 'o1', ['order.new'])).toBe(3);
      expect(prisma.staffNotification.updateMany.mock.calls[0][0].where).toEqual({
        entityType: 'Order', entityId: 'o1', resolvedAt: null, type: { in: ['order.new'] },
      });
      await service.resolveFor('Order', 'o1');
      expect(prisma.staffNotification.updateMany.mock.calls[1][0].where).not.toHaveProperty('type');
    });

    it('resolveFor never throws', async () => {
      prisma.staffNotification.updateMany.mockRejectedValueOnce(new Error('db down'));
      await expect(service.resolveFor('Order', 'o1')).resolves.toBe(0);
    });
  });

  describe('remind', () => {
    const now = new Date('2026-10-20T12:00:00Z');

    it('re-raises open URGENT notices after 15 min and HIGH after 30, in place, capped', async () => {
      prisma.staffNotification.updateMany.mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
      expect(await service.remind(now)).toBe(3);

      const [urgent, high] = prisma.staffNotification.updateMany.mock.calls.map((c: any[]) => c[0]);
      expect(urgent.where).toMatchObject({ priority: 'URGENT', resolvedAt: null, remindCount: { lt: MAX_REMINDERS } });
      expect(urgent.where.OR).toEqual([
        { lastRemindedAt: null, createdAt: { lte: new Date('2026-10-20T11:45:00Z') } },
        { lastRemindedAt: { lte: new Date('2026-10-20T11:45:00Z') } },
      ]);
      expect(high.where.priority).toBe('HIGH');
      expect(high.where.OR[0].createdAt.lte).toEqual(new Date('2026-10-20T11:30:00Z'));
      // unread again, counted — never a new row
      expect(urgent.data).toEqual({ remindCount: { increment: 1 }, lastRemindedAt: now, readAt: null, readById: null });
      expect(prisma.staffNotification.upsert).not.toHaveBeenCalled();
      expect(MAX_REMINDERS).toBe(6);
    });

    it('does nothing when nothing is due', async () => {
      prisma.staffNotification.updateMany.mockResolvedValue({ count: 0 });
      expect(await service.remind(now)).toBe(0);
    });
  });
});

describe('StaffRemindersProcessor', () => {
  it('runs the reminder sweep and refuses other jobs', async () => {
    const staff = { remind: jest.fn().mockResolvedValue(4) };
    const processor = new StaffRemindersProcessor(staff as any);
    await expect(processor.process({ name: STAFF_REMIND_JOB } as any)).resolves.toEqual({ reminded: 4 });
    await expect(processor.process({ name: 'other' } as any)).rejects.toThrow('Unknown staff reminders job');
  });
});
