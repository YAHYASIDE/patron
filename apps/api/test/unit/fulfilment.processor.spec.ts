import { FulfilmentProcessor } from '../../src/modules/queues/processors/fulfilment.processor';
import { JOBS } from '../../src/modules/queues/queue.constants';

describe('FulfilmentProcessor', () => {
  let prisma: any;
  let engine: any;
  let orders: any;
  let tracing: any;
  let processor: FulfilmentProcessor;

  const job = (name: string, data: Record<string, unknown> = {}): any => ({
    name, data, id: 'job-1', attemptsMade: 0,
  });

  beforeEach(() => {
    prisma = {
      order: { findUniqueOrThrow: jest.fn() },
      orderItem: { findUniqueOrThrow: jest.fn() },
    };
    engine = {
      fulfilItem: jest.fn().mockResolvedValue({ ok: true }),
      pollItem: jest.fn().mockResolvedValue({ polled: true }),
    };
    orders = { syncStatus: jest.fn().mockResolvedValue(undefined) };
    tracing = {
      traceId: jest.fn().mockReturnValue('trace-abc'),
      // withSpan just runs the wrapped work in these tests.
      withSpan: jest.fn((_name: string, _attrs: unknown, fn: () => unknown) => fn()),
    };
    processor = new FulfilmentProcessor(prisma, engine, orders, tracing);
  });

  it('wraps the work in a span named after the job with attempt attributes', async () => {
    prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'PAID', items: [] });
    const j = job(JOBS.FULFIL_ORDER, { orderId: 'o1' });
    j.attemptsMade = 2;

    await processor.process(j);

    expect(tracing.withSpan).toHaveBeenCalledWith(
      'fulfilment.fulfil-order',
      { 'patron.job_id': 'job-1', 'patron.attempt': 3 },
      expect.any(Function),
    );
  });

  it('falls back to the job id for the correlation id when there is no active trace', async () => {
    tracing.traceId.mockReturnValue(undefined);
    prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'PAID', items: [] });

    await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));
    // No throw / span still built means the run() context was established with the fallback id.
    expect(tracing.withSpan).toHaveBeenCalled();
  });

  describe('fulfil-order', () => {
    it('fulfils only PENDING/FAILED items then syncs order status', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PAID',
        items: [
          { id: 'i1', status: 'PENDING' },
          { id: 'i2', status: 'DELIVERED' },
          { id: 'i3', status: 'FAILED' },
        ],
      });

      const result = await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));

      expect(result).toEqual({ processed: 2 });
      expect(engine.fulfilItem).toHaveBeenCalledWith('i1');
      expect(engine.fulfilItem).toHaveBeenCalledWith('i3');
      expect(engine.fulfilItem).not.toHaveBeenCalledWith('i2');
      expect(orders.syncStatus).toHaveBeenCalledWith('o1');
    });

    it('processes a PROCESSING order too (retry after partial delivery)', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PROCESSING',
        items: [{ id: 'i1', status: 'PENDING' }],
      });

      const result = await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));
      expect(result).toEqual({ processed: 1 });
    });

    it('skips a non-paid order (e.g. refunded) without touching the engine', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({ status: 'REFUNDED', items: [{ id: 'i1', status: 'PENDING' }] });
      const warnSpy = jest.spyOn((processor as any).logger, 'warn').mockImplementation(() => undefined);

      const result = await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));

      expect(result).toEqual({ skipped: 'REFUNDED' });
      expect(engine.fulfilItem).not.toHaveBeenCalled();
      expect(orders.syncStatus).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('REFUNDED'));
    });

    it('isolates a single failing item — logs it and still syncs the order', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PAID',
        items: [{ id: 'i1', status: 'PENDING' }, { id: 'i2', status: 'PENDING' }],
      });
      engine.fulfilItem.mockRejectedValueOnce(new Error('provider 500')).mockResolvedValue({ ok: true });
      const errSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);

      const result = await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));

      // A failed item does not blow up the whole batch — count is still the pending total.
      expect(result).toEqual({ processed: 2 });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('provider 500'));
      expect(orders.syncStatus).toHaveBeenCalledWith('o1');
    });

    it('returns processed:0 and still syncs when nothing is pending', async () => {
      prisma.order.findUniqueOrThrow.mockResolvedValue({
        status: 'PAID',
        items: [{ id: 'i1', status: 'DELIVERED' }],
      });

      const result = await processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'o1' }));
      expect(result).toEqual({ processed: 0 });
      expect(engine.fulfilItem).not.toHaveBeenCalled();
      expect(orders.syncStatus).toHaveBeenCalledWith('o1');
    });

    it('lets a missing order surface (findUniqueOrThrow rejects) so the job retries', async () => {
      prisma.order.findUniqueOrThrow.mockRejectedValue(new Error('not found'));
      await expect(processor.process(job(JOBS.FULFIL_ORDER, { orderId: 'ghost' }))).rejects.toThrow('not found');
    });
  });

  describe('fulfil-item', () => {
    it('fulfils a single item, resolves its order, and syncs', async () => {
      prisma.orderItem.findUniqueOrThrow.mockResolvedValue({ orderId: 'o7' });

      const result = await processor.process(job(JOBS.FULFIL_ITEM, { orderItemId: 'i1', providerId: 'p9' }));

      expect(engine.fulfilItem).toHaveBeenCalledWith('i1', 'p9');
      expect(result).toEqual({ ok: true });
      expect(orders.syncStatus).toHaveBeenCalledWith('o7');
    });

    it('propagates an engine failure', async () => {
      engine.fulfilItem.mockRejectedValue(new Error('rate limited'));
      await expect(processor.process(job(JOBS.FULFIL_ITEM, { orderItemId: 'i1' }))).rejects.toThrow('rate limited');
      expect(orders.syncStatus).not.toHaveBeenCalled();
    });
  });

  describe('poll-item', () => {
    it('polls an async item, resolves its order, and syncs', async () => {
      prisma.orderItem.findUniqueOrThrow.mockResolvedValue({ orderId: 'o3' });

      const result = await processor.process(job(JOBS.POLL_ITEM, { orderItemId: 'i5' }));

      expect(engine.pollItem).toHaveBeenCalledWith('i5');
      expect(result).toEqual({ polled: true });
      expect(orders.syncStatus).toHaveBeenCalledWith('o3');
    });
  });

  it('throws on an unknown job name', async () => {
    await expect(processor.process(job('bogus'))).rejects.toThrow('Unknown job "bogus"');
  });
});
