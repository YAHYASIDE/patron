import { MetricsCollector } from '../../src/modules/queues/processors/metrics.collector';

describe('MetricsCollector', () => {
  let prisma: any;
  let metrics: any;
  let fulfilment: any;
  let notifications: any;
  let maintenance: any;
  let collector: MetricsCollector;

  const gauge = () => ({ set: jest.fn() });

  beforeEach(() => {
    prisma = {
      outboxEvent: { count: jest.fn().mockResolvedValue(0) },
      provider: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    metrics = {
      queueDepth: gauge(),
      workerHeartbeat: gauge(),
      outboxPending: gauge(),
      outboxDead: gauge(),
      providerHealthy: gauge(),
      providerBalance: gauge(),
      fxRateAge: gauge(),
    };
    const counts = { waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 };
    fulfilment = { getJobCounts: jest.fn().mockResolvedValue(counts) };
    notifications = { getJobCounts: jest.fn().mockResolvedValue(counts) };
    maintenance = { getJobCounts: jest.fn().mockResolvedValue(counts) };
    collector = new MetricsCollector(prisma, metrics, fulfilment, notifications, maintenance);
  });

  const collect = () => (collector as any).collect();

  describe('lifecycle', () => {
    it('does not start sampling under NODE_ENV=test', () => {
      const spy = jest.spyOn(global, 'setInterval');
      collector.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('starts an unref-ed 15s interval outside test env and clears it on destroy', () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const unref = jest.fn();
      const setSpy = jest.spyOn(global, 'setInterval').mockReturnValue({ unref } as any);
      const clearSpy = jest.spyOn(global, 'clearInterval').mockImplementation(() => undefined);

      try {
        collector.onModuleInit();
        expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);
        expect(unref).toHaveBeenCalled();

        collector.onModuleDestroy();
        expect(clearSpy).toHaveBeenCalled();
      } finally {
        setSpy.mockRestore();
        clearSpy.mockRestore();
        process.env.NODE_ENV = original;
      }
    });

    it('onModuleDestroy is a no-op when no timer exists', () => {
      const clearSpy = jest.spyOn(global, 'clearInterval');
      collector.onModuleDestroy();
      expect(clearSpy).not.toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });

  describe('collect', () => {
    it('records queue depth per state plus a worker heartbeat for all three queues', async () => {
      await collect();

      expect(fulfilment.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'completed', 'failed', 'delayed');
      // 3 queues x 5 states.
      expect(metrics.queueDepth.set).toHaveBeenCalledTimes(15);
      expect(metrics.queueDepth.set).toHaveBeenCalledWith({ queue: 'fulfilment', state: 'waiting' }, 1);
      expect(metrics.queueDepth.set).toHaveBeenCalledWith({ queue: 'maintenance', state: 'delayed' }, 5);
      expect(metrics.workerHeartbeat.set).toHaveBeenCalledTimes(3);
      expect(metrics.workerHeartbeat.set).toHaveBeenCalledWith(
        { queue: 'notifications' },
        expect.any(Number),
      );
    });

    it('records outbox pending and dead backlogs', async () => {
      prisma.outboxEvent.count
        .mockResolvedValueOnce(7)   // PENDING
        .mockResolvedValueOnce(2);  // DEAD

      await collect();

      expect(prisma.outboxEvent.count).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
      expect(prisma.outboxEvent.count).toHaveBeenCalledWith({ where: { status: 'DEAD' } });
      expect(metrics.outboxPending.set).toHaveBeenCalledWith(7);
      expect(metrics.outboxDead.set).toHaveBeenCalledWith(2);
    });

    it('records health and (Decimal-coerced) balance for each active provider', async () => {
      prisma.provider.findMany.mockResolvedValue([
        { code: 'DZ', isHealthy: true, balance: { toString: () => '100.5' } },
        { code: 'MA', isHealthy: false, balance: 0 },
      ]);

      await collect();

      expect(prisma.provider.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        select: { code: true, isHealthy: true, balance: true },
      });
      expect(metrics.providerHealthy.set).toHaveBeenCalledWith({ provider: 'DZ' }, 1);
      expect(metrics.providerHealthy.set).toHaveBeenCalledWith({ provider: 'MA' }, 0);
      expect(metrics.providerBalance.set).toHaveBeenCalledWith({ provider: 'DZ' }, 100.5);
      expect(metrics.providerBalance.set).toHaveBeenCalledWith({ provider: 'MA' }, 0);
    });

    it('records FX rate age per currency from the raw query', async () => {
      prisma.$queryRaw.mockResolvedValue([
        { quoteCurrency: 'NGN', age: '3600' },
        { quoteCurrency: 'GHS', age: 120 },
      ]);

      await collect();

      expect(metrics.fxRateAge.set).toHaveBeenCalledWith({ currency: 'NGN' }, 3600);
      expect(metrics.fxRateAge.set).toHaveBeenCalledWith({ currency: 'GHS' }, 120);
    });

    it('swallows a collection failure and logs a warning (never throws into the interval)', async () => {
      prisma.outboxEvent.count.mockRejectedValue(new Error('db down'));
      const warnSpy = jest.spyOn((collector as any).logger, 'warn').mockImplementation(() => undefined);

      await expect(collect()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });

    it('emits nothing extra when providers and fx rates are empty', async () => {
      await collect();
      expect(metrics.providerHealthy.set).not.toHaveBeenCalled();
      expect(metrics.fxRateAge.set).not.toHaveBeenCalled();
      // outbox + queue metrics still run.
      expect(metrics.outboxPending.set).toHaveBeenCalled();
    });
  });
});
