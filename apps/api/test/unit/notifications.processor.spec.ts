import { NotificationsProcessor } from '../../src/modules/queues/processors/notifications.processor';
import { JOBS } from '../../src/modules/queues/queue.constants';

describe('NotificationsProcessor', () => {
  let notifications: any;
  let prisma: any;
  let processor: NotificationsProcessor;

  const job = (name: string, data: Record<string, unknown>): any => ({
    name, data, id: '1', attemptsMade: 0,
  });

  beforeEach(() => {
    notifications = { dispatch: jest.fn().mockResolvedValue({ sent: true }) };
    prisma = { order: { findUnique: jest.fn().mockResolvedValue(null) } };
    processor = new NotificationsProcessor(notifications, prisma);
  });

  it('rejects an unknown job name', async () => {
    await expect(
      processor.process(job('nope', { userId: 'u1', templateKey: 't' })),
    ).rejects.toThrow('Unknown job "nope"');
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });

  it('dispatches with empty variables when there is no order-linked data', async () => {
    const result = await processor.process(
      job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'welcome' }),
    );

    expect(result).toEqual({ sent: true });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'u1',
      templateKey: 'welcome',
      variables: {},
      data: undefined,
    });
  });

  it('hydrates order template variables when data carries an orderId', async () => {
    prisma.order.findUnique.mockResolvedValue({
      orderNumber: 'PN-1001',
      total: { toString: () => '42.50' },
      currency: 'USD',
    });
    const data = { orderId: 'o1', foo: 'bar' };

    await processor.process(job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'order.paid', data }));

    expect(prisma.order.findUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      select: { orderNumber: true, total: true, currency: true },
    });
    expect(notifications.dispatch).toHaveBeenCalledWith({
      userId: 'u1',
      templateKey: 'order.paid',
      variables: { orderNumber: 'PN-1001', total: '42.50', currency: 'USD' },
      data,
    });
  });

  it('coerces a non-string orderId to a string before the lookup', async () => {
    await processor.process(
      job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'order.paid', data: { orderId: 123 } }),
    );
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: '123' } }),
    );
  });

  it('dispatches with empty variables when the referenced order no longer exists', async () => {
    prisma.order.findUnique.mockResolvedValue(null);

    await processor.process(
      job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'order.paid', data: { orderId: 'gone' } }),
    );

    expect(notifications.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ variables: {} }),
    );
  });

  it('propagates a dispatch failure so BullMQ retries the notification', async () => {
    notifications.dispatch.mockRejectedValue(new Error('smtp down'));
    await expect(
      processor.process(job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'welcome' })),
    ).rejects.toThrow('smtp down');
  });

  it('propagates an order-lookup failure', async () => {
    prisma.order.findUnique.mockRejectedValue(new Error('db gone'));
    await expect(
      processor.process(
        job(JOBS.SEND_NOTIFICATION, { userId: 'u1', templateKey: 'order.paid', data: { orderId: 'o1' } }),
      ),
    ).rejects.toThrow('db gone');
    expect(notifications.dispatch).not.toHaveBeenCalled();
  });
});
