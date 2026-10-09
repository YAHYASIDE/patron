import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { InAppChannel } from '../../src/modules/notifications/channels/in-app.channel';
import { EmailChannel } from '../../src/modules/notifications/channels/email.channel';
import { PushChannel } from '../../src/modules/notifications/channels/push.channel';

describe('NotificationsService', () => {
  let prisma: any;
  let moduleRef: any;
  let service: NotificationsService;

  let inApp: any;
  let email: any;
  let push: any;

  const baseUser = {
    id: 'u1',
    email: 'user@example.com',
    phone: '+9700000000',
    locale: 'en',
    devices: [{ token: 'dev-a' }, { token: 'dev-b' }],
  };

  const template = {
    key: 'order.shipped',
    isActive: true,
    titleAr: 'مرحبا {{name}}',
    bodyAr: 'طلبك {{order}}',
    titleEn: 'Hi {{name}}',
    bodyEn: 'Order {{order}} shipped',
    channels: ['IN_APP', 'EMAIL', 'PUSH'],
  };

  beforeEach(() => {
    inApp = { code: 'IN_APP', isEnabled: true, send: jest.fn().mockResolvedValue({ sent: true }) };
    email = { code: 'EMAIL', isEnabled: true, send: jest.fn().mockResolvedValue({ sent: true }) };
    push = { code: 'PUSH', isEnabled: true, send: jest.fn().mockResolvedValue({ sent: true }) };

    const byClass: Record<string, any> = {
      [InAppChannel.name]: inApp,
      [EmailChannel.name]: email,
      [PushChannel.name]: push,
    };

    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(baseUser) },
      notificationTemplate: { findUnique: jest.fn().mockResolvedValue(template) },
      notification: {
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: `rec-${data.channel}` })),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ id: 'n1' }]),
        count: jest.fn().mockResolvedValue(3),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn().mockResolvedValue([[{ id: 'n1' }], 7]),
    };

    moduleRef = { get: jest.fn((type: any) => byClass[type.name]) };

    service = new NotificationsService(prisma, moduleRef);
    service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('registers each channel keyed by its code', () => {
      expect(moduleRef.get).toHaveBeenCalledTimes(3);
      expect(moduleRef.get).toHaveBeenCalledWith(InAppChannel, { strict: false });
    });
  });

  describe('dispatch', () => {
    const req = {
      userId: 'u1',
      templateKey: 'order.shipped',
      variables: { name: 'Sam', order: 'PTN-1' },
      data: { orderId: 'o1' },
    };

    it('renders variables, delivers to every enabled channel and reports outcomes', async () => {
      const res = await service.dispatch(req);

      expect(res).toEqual({ delivered: { IN_APP: true, EMAIL: true, PUSH: true } });

      // English locale -> preferred title/body come from the *En fields, rendered.
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Hi Sam',
          body: 'Order PTN-1 shipped',
          email: 'user@example.com',
          phone: '+9700000000',
          deviceTokens: ['dev-a', 'dev-b'],
          locale: 'en',
        }),
      );

      // A record is created and then stamped sent for each channel.
      expect(prisma.notification.create).toHaveBeenCalledTimes(3);
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rec-EMAIL' }, data: expect.objectContaining({ error: undefined }) }),
      );
      const sentUpdate = prisma.notification.update.mock.calls[0][0].data;
      expect(sentUpdate.sentAt).toBeInstanceOf(Date);
    });

    it('uses the Arabic strings when the user locale is ar', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, locale: 'ar' });

      await service.dispatch(req);

      expect(inApp.send).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'مرحبا Sam', body: 'طلبك PTN-1', locale: 'ar' }),
      );
    });

    it('honours an explicit channels override on the request', async () => {
      await service.dispatch({ ...req, channels: ['EMAIL'] as any });

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(inApp.send).not.toHaveBeenCalled();
      expect(push.send).not.toHaveBeenCalled();
    });

    it('filters out an unknown channel code that has no registered handler', async () => {
      const res = await service.dispatch({ ...req, channels: ['SMS', 'EMAIL'] as any });

      expect(email.send).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ delivered: { EMAIL: true } });
    });

    it('passes undefined phone through when the user has none on file', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, phone: null });

      await service.dispatch({ ...req, channels: ['EMAIL'] as any });

      expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ phone: undefined }));
    });

    it('skips channels that are disabled', async () => {
      email.isEnabled = false;

      const res = await service.dispatch(req);

      expect(email.send).not.toHaveBeenCalled();
      expect(res).toEqual({ delivered: { IN_APP: true, PUSH: true } });
    });

    it('records the error and leaves sentAt null when a channel fails', async () => {
      push.send.mockResolvedValue({ sent: false, error: 'No registered devices' });

      const res = await service.dispatch(req);

      expect(res).toEqual({ delivered: { IN_APP: true, EMAIL: true, PUSH: false } });
      expect(prisma.notification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-PUSH' },
          data: { sentAt: null, error: 'No registered devices' },
        }),
      );
    });

    it('leaves template text untouched when no variables are supplied', async () => {
      await service.dispatch({ userId: 'u1', templateKey: 'order.shipped' });

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Hi {{name}}', body: 'Order {{order}} shipped' }),
      );
    });

    it('substitutes an empty string for an unknown variable key', async () => {
      await service.dispatch({ userId: 'u1', templateKey: 'order.shipped', variables: { name: 'Sam' } });

      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Hi Sam', body: 'Order  shipped' }),
      );
    });

    it('defaults the persisted data payload to an empty object', async () => {
      await service.dispatch({ userId: 'u1', templateKey: 'order.shipped', channels: ['IN_APP'] as any });

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ data: {} }) }),
      );
    });

    it('falls back to the template channels when the request omits them', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({ ...template, channels: ['EMAIL'] });

      const res = await service.dispatch({ userId: 'u1', templateKey: 'order.shipped' });

      expect(res).toEqual({ delivered: { EMAIL: true } });
    });

    it('skips when the user is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      const res = await service.dispatch(req);

      expect(res).toEqual({ skipped: 'user_missing' });
      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('skips when the template is absent', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue(null);

      const res = await service.dispatch(req);

      expect(res).toEqual({ skipped: 'template_missing' });
    });

    it('skips when the template exists but is inactive', async () => {
      prisma.notificationTemplate.findUnique.mockResolvedValue({ ...template, isActive: false });

      const res = await service.dispatch(req);

      expect(res).toEqual({ skipped: 'template_missing' });
      expect(inApp.send).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    it('queries only IN_APP notifications and paginates the result', async () => {
      const query: any = { page: 2, limit: 10, order: 'desc', skip: 10 };

      const res = await service.listForUser('u1', query);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'u1', channel: 'IN_APP' },
          skip: 10,
          take: 10,
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(res).toEqual({ data: [{ id: 'n1' }], meta: { page: 2, limit: 10, total: 7, pages: 1 } });
    });
  });

  describe('unreadCount', () => {
    it('counts unread IN_APP notifications for the user', async () => {
      const res = await service.unreadCount('u1');

      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'u1', isRead: false, channel: 'IN_APP' },
      });
      expect(res).toBe(3);
    });
  });

  describe('markRead', () => {
    it('marks all unread notifications read when no ids are given', async () => {
      await service.markRead('u1');

      const arg = prisma.notification.updateMany.mock.calls[0][0];
      expect(arg.where).toEqual({ userId: 'u1', isRead: false });
      expect(arg.data.isRead).toBe(true);
      expect(arg.data.readAt).toBeInstanceOf(Date);
    });

    it('scopes the update to the supplied ids', async () => {
      await service.markRead('u1', ['a', 'b']);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', isRead: false, id: { in: ['a', 'b'] } } }),
      );
    });

    it('ignores an empty id array (no id filter)', async () => {
      await service.markRead('u1', []);

      expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', isRead: false });
    });
  });
});
