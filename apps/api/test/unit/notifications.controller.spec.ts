import { NotificationsController } from '../../src/modules/notifications/notifications.controller';

describe('NotificationsController', () => {
  let notifications: any;
  let controller: NotificationsController;

  beforeEach(() => {
    notifications = {
      listForUser: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      unreadCount: jest.fn().mockResolvedValue(5),
      markRead: jest.fn().mockResolvedValue({ count: 2 }),
    };
    controller = new NotificationsController(notifications);
  });

  describe('list', () => {
    it('delegates to the service with the user id and query', async () => {
      const query: any = { page: 1, limit: 20 };

      const res = await controller.list('u1', query);

      expect(notifications.listForUser).toHaveBeenCalledWith('u1', query);
      expect(res).toEqual({ data: [], meta: {} });
    });
  });

  describe('unread', () => {
    it('wraps the count in a { count } envelope', async () => {
      const res = await controller.unread('u1');

      expect(notifications.unreadCount).toHaveBeenCalledWith('u1');
      expect(res).toEqual({ count: 5 });
    });
  });

  describe('markRead', () => {
    it('forwards the ids to the service', async () => {
      const res = await controller.markRead('u1', ['a', 'b']);

      expect(notifications.markRead).toHaveBeenCalledWith('u1', ['a', 'b']);
      expect(res).toEqual({ count: 2 });
    });

    it('passes undefined through when no ids are supplied', async () => {
      await controller.markRead('u1');

      expect(notifications.markRead).toHaveBeenCalledWith('u1', undefined);
    });
  });
});
