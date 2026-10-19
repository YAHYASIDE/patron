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
    const A = '6f1c2a34-1b2c-4d5e-8f90-0a1b2c3d4e5f';
    const B = '7a2d3b45-2c3d-4e5f-9a01-1b2c3d4e5f60';

    it('forwards the ids to the service and answers { updated }', async () => {
      const res = await controller.markRead('u1', [A, B]);

      expect(notifications.markRead).toHaveBeenCalledWith('u1', [A, B]);
      expect(res).toEqual({ updated: 2 });
    });

    it('marks everything read when no ids are supplied', async () => {
      await controller.markRead('u1');
      await controller.markRead('u1', null);

      expect(notifications.markRead).toHaveBeenNthCalledWith(1, 'u1');
      expect(notifications.markRead).toHaveBeenNthCalledWith(2, 'u1');
    });

    it('drops malformed ids, and touches nothing when none is left', async () => {
      await controller.markRead('u1', [A, 'nope', 7]);
      expect(notifications.markRead).toHaveBeenCalledWith('u1', [A]);

      notifications.markRead.mockClear();
      await expect(controller.markRead('u1', ['nope'])).resolves.toEqual({ updated: 0 });
      await expect(controller.markRead('u1', 'all')).resolves.toEqual({ updated: 0 });
      expect(notifications.markRead).not.toHaveBeenCalled();
    });
  });
});
