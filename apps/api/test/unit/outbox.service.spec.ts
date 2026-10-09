import { OutboxService } from '../../src/common/outbox/outbox.service';

describe('OutboxService', () => {
  let prisma: any;
  let service: OutboxService;

  beforeEach(() => {
    prisma = {
      outboxEvent: { update: jest.fn().mockResolvedValue({}) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new OutboxService(prisma);
  });

  describe('emit', () => {
    it('writes the event through the passed transaction client, not the root prisma', () => {
      const tx: any = { outboxEvent: { create: jest.fn().mockReturnValue('created') } };

      const result = service.emit(tx, {
        aggregate: 'order',
        aggregateId: 'o1',
        eventType: 'order.paid',
        payload: { orderId: 'o1', userId: 'u1' },
      });

      expect(result).toBe('created');
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: {
          aggregate: 'order',
          aggregateId: 'o1',
          eventType: 'order.paid',
          payload: { orderId: 'o1', userId: 'u1' },
        },
      });
      // Must never touch the non-transactional client — that would break atomicity.
      expect(prisma.outboxEvent.update).not.toHaveBeenCalled();
    });
  });

  describe('claimBatch', () => {
    it('runs the SKIP LOCKED claim query and returns the rows', async () => {
      const rows = [{ id: 'e1', eventType: 'order.paid', attempts: 1 }];
      prisma.$queryRaw.mockResolvedValue(rows);

      const result = await service.claimBatch(50);

      expect(result).toBe(rows);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      // limit is interpolated as a tagged-template parameter, so it shows up in the values array.
      const values = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toContain(50);
    });

    it('defaults the batch size to 100', async () => {
      await service.claimBatch();
      const values = prisma.$queryRaw.mock.calls[0].slice(1);
      expect(values).toContain(100);
    });
  });

  describe('markPublished', () => {
    it('flips the row to PUBLISHED and stamps publishedAt', async () => {
      await service.markPublished('e1');

      const arg = prisma.outboxEvent.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'e1' });
      expect(arg.data.status).toBe('PUBLISHED');
      expect(arg.data.publishedAt).toBeInstanceOf(Date);
    });
  });

  describe('markFailed', () => {
    it('reschedules with exponential backoff while attempts remain', async () => {
      const before = Date.now();
      await service.markFailed('e1', 3, 'boom');

      const arg = prisma.outboxEvent.update.mock.calls[0][0];
      expect(arg.data.status).toBe('PENDING');
      expect(arg.data.lastError).toBe('boom');
      // 2 ** 3 * 1000 = 8000ms of delay.
      const delay = (arg.data.availableAt as Date).getTime() - before;
      expect(delay).toBeGreaterThanOrEqual(8_000);
      expect(delay).toBeLessThan(8_000 + 2_000);
    });

    it('caps the backoff delay at five minutes', async () => {
      const before = Date.now();
      // 2 ** 20 * 1000 would be ~17 minutes; must clamp to 300_000ms.
      await service.markFailed('e1', 20, 'boom', 999);

      const arg = prisma.outboxEvent.update.mock.calls[0][0];
      const delay = (arg.data.availableAt as Date).getTime() - before;
      expect(delay).toBeGreaterThanOrEqual(300_000);
      expect(delay).toBeLessThan(300_000 + 2_000);
    });

    it('parks the event in DEAD once attempts reach the max', async () => {
      await service.markFailed('e1', 8, 'still broken');

      const arg = prisma.outboxEvent.update.mock.calls[0][0];
      expect(arg.where).toEqual({ id: 'e1' });
      expect(arg.data.status).toBe('DEAD');
      expect(arg.data.lastError).toBe('still broken');
      expect(arg.data.availableAt).toBeUndefined();
    });

    it('honours a custom maxAttempts threshold', async () => {
      await service.markFailed('e1', 2, 'nope', 2);

      const arg = prisma.outboxEvent.update.mock.calls[0][0];
      expect(arg.data.status).toBe('DEAD');
    });
  });
});
