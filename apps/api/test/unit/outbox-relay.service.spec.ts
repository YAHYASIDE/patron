import { OutboxRelay } from '../../src/modules/queues/outbox-relay.service';
import { JOBS } from '../../src/modules/queues/queue.constants';

describe('OutboxRelay', () => {
  let outbox: any;
  let fulfilment: any;
  let notifications: any;
  let relay: OutboxRelay;

  beforeEach(() => {
    outbox = {
      claimBatch: jest.fn().mockResolvedValue([]),
      markPublished: jest.fn().mockResolvedValue({}),
      markFailed: jest.fn().mockResolvedValue({}),
    };
    fulfilment = { add: jest.fn().mockResolvedValue({}) };
    notifications = { add: jest.fn().mockResolvedValue({}) };
    relay = new OutboxRelay(outbox, fulfilment, notifications);
  });

  // tick() is private; the relay drives it internally. We reach it the same way
  // the interval would, keeping the test at the public seam.
  const tick = () => (relay as any).tick();

  describe('lifecycle', () => {
    it('does not start the interval under NODE_ENV=test', () => {
      const spy = jest.spyOn(global, 'setInterval');
      relay.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('starts and later clears an unref-ed interval outside test env', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const unref = jest.fn();
      const setSpy = jest
        .spyOn(global, 'setInterval')
        .mockReturnValue({ unref } as any);
      const clearSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

      try {
        relay.onModuleInit();
        expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
        expect(unref).toHaveBeenCalled();

        relay.onModuleDestroy();
        expect(clearSpy).toHaveBeenCalled();
      } finally {
        setSpy.mockRestore();
        clearSpy.mockRestore();
        process.env.NODE_ENV = original;
      }
    });

    it('onModuleDestroy is a no-op when no timer was started', () => {
      const clearSpy = jest.spyOn(global, 'clearInterval');
      relay.onModuleDestroy();
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('routing', () => {
    it('routes order.paid to a fulfilment job plus a notification, with idempotent job ids', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e1', eventType: 'order.paid', payload: { orderId: 'o1', userId: 'u1' }, attempts: 1 },
      ]);

      await tick();

      expect(fulfilment.add).toHaveBeenCalledWith(
        JOBS.FULFIL_ORDER,
        expect.objectContaining({ orderId: 'o1', userId: 'u1' }),
        expect.objectContaining({ jobId: 'fulfil-o1' }),
      );
      expect(notifications.add).toHaveBeenCalledWith(
        JOBS.SEND_NOTIFICATION,
        expect.objectContaining({ userId: 'u1', templateKey: 'order.paid' }),
        expect.objectContaining({ jobId: 'notify-e1' }),
      );
      expect(outbox.markPublished).toHaveBeenCalledWith('e1');
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it.each(['order.completed', 'order.partially_completed', 'order.failed', 'refund.processed'])(
      'routes %s to a notification only',
      async (eventType) => {
        outbox.claimBatch.mockResolvedValue([
          { id: 'e9', eventType, payload: { userId: 'u1' }, attempts: 0 },
        ]);

        await tick();

        expect(fulfilment.add).not.toHaveBeenCalled();
        expect(notifications.add).toHaveBeenCalledTimes(1);
        const [job, body, opts] = notifications.add.mock.calls[0];
        expect(job).toBe(JOBS.SEND_NOTIFICATION);
        // refund.processed is normalised to that exact templateKey; the order.* pass through.
        expect(body.templateKey).toBe(eventType);
        expect(opts.jobId).toBe('notify-e9');
        expect(outbox.markPublished).toHaveBeenCalledWith('e9');
      },
    );

    it('treats order.created as a published no-op (kept for the audit trail)', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e2', eventType: 'order.created', payload: { orderId: 'o1' }, attempts: 0 },
      ]);

      await tick();

      expect(fulfilment.add).not.toHaveBeenCalled();
      expect(notifications.add).not.toHaveBeenCalled();
      expect(outbox.markPublished).toHaveBeenCalledWith('e2');
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it('warns and still marks unknown event types published rather than poisoning the relay', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e3', eventType: 'mystery.thing', payload: {}, attempts: 0 },
      ]);

      await tick();

      expect(fulfilment.add).not.toHaveBeenCalled();
      expect(notifications.add).not.toHaveBeenCalled();
      expect(outbox.markPublished).toHaveBeenCalledWith('e3');
    });

    it('skips the notification when the payload has no userId', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e4', eventType: 'order.completed', payload: {}, attempts: 0 },
      ]);

      await tick();

      expect(notifications.add).not.toHaveBeenCalled();
      // Still published — a missing recipient is an emitter bug, not a relay failure.
      expect(outbox.markPublished).toHaveBeenCalledWith('e4');
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });

    it('still fulfils an order.paid event even when its userId is missing', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e5', eventType: 'order.paid', payload: { orderId: 'o2' }, attempts: 0 },
      ]);

      await tick();

      expect(fulfilment.add).toHaveBeenCalledTimes(1);
      expect(notifications.add).not.toHaveBeenCalled();
      expect(outbox.markPublished).toHaveBeenCalledWith('e5');
    });

    it('ignores a numeric orderId at runtime so the job id never becomes fulfil-undefined-shaped garbage', async () => {
      // payload comes from Json, so a bad emitter could write orderId: 123.
      outbox.claimBatch.mockResolvedValue([
        { id: 'e6', eventType: 'order.paid', payload: { orderId: 123, userId: 'u1' }, attempts: 0 },
      ]);

      await tick();

      const opts = fulfilment.add.mock.calls[0][2];
      expect(opts.jobId).toBe('fulfil-undefined');
    });

    it('coerces a non-object payload (array/string/null) to an empty payload', async () => {
      outbox.claimBatch.mockResolvedValue([
        { id: 'e7', eventType: 'order.paid', payload: ['not', 'an', 'object'], attempts: 0 },
        { id: 'e8', eventType: 'order.completed', payload: null, attempts: 0 },
      ]);

      await tick();

      // e7: fulfilment fires with no orderId/userId.
      expect(fulfilment.add.mock.calls[0][2].jobId).toBe('fulfil-undefined');
      // e8: null payload -> no userId -> notification skipped, both published.
      expect(outbox.markPublished).toHaveBeenCalledWith('e7');
      expect(outbox.markPublished).toHaveBeenCalledWith('e8');
    });
  });

  describe('failure handling', () => {
    it('marks an event failed (with its attempt count) when publish throws', async () => {
      fulfilment.add.mockRejectedValue(new Error('redis down'));
      outbox.claimBatch.mockResolvedValue([
        { id: 'e1', eventType: 'order.paid', payload: { orderId: 'o1', userId: 'u1' }, attempts: 4 },
      ]);

      await tick();

      expect(outbox.markPublished).not.toHaveBeenCalled();
      expect(outbox.markFailed).toHaveBeenCalledWith('e1', 4, 'redis down');
    });

    it('isolates a failing event and keeps processing the rest of the batch', async () => {
      notifications.add
        .mockRejectedValueOnce(new Error('first blew up'))
        .mockResolvedValue({});
      outbox.claimBatch.mockResolvedValue([
        { id: 'bad', eventType: 'order.completed', payload: { userId: 'u1' }, attempts: 2 },
        { id: 'good', eventType: 'order.failed', payload: { userId: 'u2' }, attempts: 0 },
      ]);

      await tick();

      expect(outbox.markFailed).toHaveBeenCalledWith('bad', 2, 'first blew up');
      expect(outbox.markPublished).toHaveBeenCalledWith('good');
    });

    it('never overlaps ticks — a second entry while one runs returns immediately', async () => {
      let release: () => void = () => undefined;
      outbox.claimBatch.mockImplementation(
        () => new Promise((resolve) => { release = () => resolve([]); }),
      );

      const first = tick();
      const second = tick(); // should short-circuit on the running guard

      release();
      await Promise.all([first, second]);

      expect(outbox.claimBatch).toHaveBeenCalledTimes(1);
    });

    it('logs and swallows a claimBatch failure, then resets the running guard', async () => {
      outbox.claimBatch.mockRejectedValueOnce(new Error('db gone'));
      const errSpy = jest
        .spyOn((relay as any).logger, 'error')
        .mockImplementation(() => undefined);

      await expect(tick()).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('db gone'));

      // Guard released: a follow-up tick runs claimBatch again.
      outbox.claimBatch.mockResolvedValue([]);
      await tick();
      expect(outbox.claimBatch).toHaveBeenCalledTimes(2);
    });

    it('processes an empty batch without touching either queue', async () => {
      outbox.claimBatch.mockResolvedValue([]);

      await tick();

      expect(fulfilment.add).not.toHaveBeenCalled();
      expect(notifications.add).not.toHaveBeenCalled();
      expect(outbox.markPublished).not.toHaveBeenCalled();
      expect(outbox.markFailed).not.toHaveBeenCalled();
    });
  });
});
