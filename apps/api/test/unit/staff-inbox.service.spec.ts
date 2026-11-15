import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { StaffInboxService } from '../../src/modules/staff-notifications/staff-inbox.service';
import { StaffNotificationsController } from '../../src/modules/staff-notifications/staff-notifications.controller';
import { InboxPrefsDto, InboxQueryDto } from '../../src/modules/staff-notifications/dto/staff-notifications.dto';

const ID = '11111111-1111-4111-8111-111111111111';

describe('StaffInboxService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: StaffInboxService;
  const row = { id: ID, type: 'order.new', priority: 'NORMAL', title: 't', body: 'b', link: '/orders/o1', createdAt: new Date(), readAt: null, resolvedAt: null, remindCount: 0 };

  beforeEach(() => {
    tx = {
      staffNotification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      staffNotificationPref: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      staffNotificationPref: { findMany: jest.fn().mockResolvedValue([]) },
      staffNotification: {
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5),
        findUnique: jest.fn().mockResolvedValue({ id: ID }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        updateMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new StaffInboxService(prisma, audit);
  });

  describe('list', () => {
    it('answers the contract: data, unread and open; open ones by priority then newest', async () => {
      const res = await service.list('u1');
      expect(res).toEqual({ data: [row], unread: 2, open: 5 });
      const q = prisma.staffNotification.findMany.mock.calls[0][0];
      expect(q.where).toEqual({ resolvedAt: null });
      expect(q.orderBy).toEqual([{ priority: 'desc' }, { createdAt: 'desc' }]);
      expect(q.take).toBe(50);
      expect(Object.keys(q.select).sort()).toEqual(
        ['body', 'createdAt', 'id', 'link', 'priority', 'readAt', 'remindCount', 'resolvedAt', 'title', 'type'],
      );
      expect(prisma.staffNotification.count.mock.calls[0][0].where).toEqual({ resolvedAt: null, readAt: null });
    });

    it('leaves out the types this person muted, from the list and the counts', async () => {
      prisma.staffNotificationPref.findMany.mockResolvedValueOnce([{ type: 'support.message' }]);
      await service.list('u1', 'all', 10);
      const q = prisma.staffNotification.findMany.mock.calls[0][0];
      expect(q.where).toEqual({ type: { notIn: ['support.message'] } });
      expect(q.orderBy).toEqual([{ createdAt: 'desc' }]);
      expect(q.take).toBe(10);
      expect(prisma.staffNotification.count.mock.calls[1][0].where).toEqual({ type: { notIn: ['support.message'] }, resolvedAt: null });
    });

    it('lists the resolved ones', async () => {
      await service.list('u1', 'resolved');
      expect(prisma.staffNotification.findMany.mock.calls[0][0].where).toEqual({ resolvedAt: { not: null } });
    });
  });

  it('marks one read, keeping the first reader', async () => {
    await expect(service.markRead(ID, 'u1')).resolves.toBe(row);
    expect(prisma.staffNotification.updateMany).toHaveBeenCalledWith({
      where: { id: ID, readAt: null }, data: { readAt: expect.any(Date), readById: 'u1' },
    });
  });

  it('404s an unknown notice with a stable code', async () => {
    prisma.staffNotification.findUnique.mockResolvedValueOnce(null);
    const err = await service.markRead(ID, 'u1').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getResponse()).toMatchObject({ error: 'STAFF_NOTIFICATION_NOT_FOUND' });
  });

  it('reads everything this person can see', async () => {
    prisma.staffNotificationPref.findMany.mockResolvedValueOnce([{ type: 'system.error' }]);
    await expect(service.readAll('u1')).resolves.toEqual({ updated: 4 });
    expect(prisma.staffNotification.updateMany.mock.calls[0][0].where).toEqual({ readAt: null, type: { notIn: ['system.error'] } });
  });

  it('resolves (and reads) a notice, audited once', async () => {
    await expect(service.resolve(ID, 'u1')).resolves.toBe(row);
    expect(tx.staffNotification.updateMany.mock.calls[0][0]).toEqual({ where: { id: ID, resolvedAt: null }, data: { resolvedAt: expect.any(Date) } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'staff_notifications.resolve', entityId: ID, actorId: 'u1' }));

    tx.staffNotification.updateMany.mockResolvedValue({ count: 0 });
    await service.resolve(ID, 'u1');
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('reads and replaces the muted types (deduplicated, sorted, audited)', async () => {
    prisma.staffNotificationPref.findMany.mockResolvedValueOnce([{ type: 'order.new' }]);
    await expect(service.prefs('u1')).resolves.toEqual({ muted: ['order.new'] });

    await expect(service.setPrefs('u1', ['system.error', 'order.new', 'system.error'])).resolves.toEqual({ muted: ['order.new', 'system.error'] });
    expect(tx.staffNotificationPref.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(tx.staffNotificationPref.createMany).toHaveBeenCalledWith({
      data: [{ userId: 'u1', type: 'order.new', muted: true }, { userId: 'u1', type: 'system.error', muted: true }],
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'staff_notifications.prefs' }));

    await service.setPrefs('u1', []);
    expect(tx.staffNotificationPref.createMany).toHaveBeenCalledTimes(1);
  });
});

describe('StaffNotificationsController', () => {
  it('passes the caller and the query through', async () => {
    const inbox = {
      list: jest.fn().mockResolvedValue('list'), prefs: jest.fn().mockResolvedValue('prefs'), setPrefs: jest.fn().mockResolvedValue('set'),
      readAll: jest.fn().mockResolvedValue('all'), markRead: jest.fn().mockResolvedValue('read'), resolve: jest.fn().mockResolvedValue('resolved'),
    };
    const c = new StaffNotificationsController(inbox as any);
    expect(await c.list({}, 'u1')).toBe('list');
    expect(inbox.list).toHaveBeenCalledWith('u1', 'open', undefined);
    expect(await c.list({ state: 'resolved', limit: 5 }, 'u1')).toBe('list');
    expect(inbox.list).toHaveBeenLastCalledWith('u1', 'resolved', 5);
    expect(await c.prefs('u1')).toBe('prefs');
    expect(await c.setPrefs({ muted: ['a.b'] }, 'u1')).toBe('set');
    expect(inbox.setPrefs).toHaveBeenCalledWith('u1', ['a.b']);
    expect(await c.readAll('u1')).toBe('all');
    expect(await c.read(ID, 'u1')).toBe('read');
    expect(await c.resolve(ID, 'u1')).toBe('resolved');
  });
});

describe('staff notification DTOs', () => {
  it('accepts the contract query and refuses unknown states and huge limits', async () => {
    expect(await validate(plainToInstance(InboxQueryDto, { state: 'open', limit: '20' }))).toHaveLength(0);
    expect(await validate(plainToInstance(InboxQueryDto, { state: 'unread' }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(InboxQueryDto, { limit: '500' }))).not.toHaveLength(0);
  });

  it('accepts domain.event types only', async () => {
    expect(await validate(plainToInstance(InboxPrefsDto, { muted: ['order.new', 'bank.unmatched'] }))).toHaveLength(0);
    expect(await validate(plainToInstance(InboxPrefsDto, { muted: ['DROP TABLE'] }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(InboxPrefsDto, { muted: 'order.new' }))).not.toHaveLength(0);
  });
});
