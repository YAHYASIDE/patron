import { HealthController } from '../../src/common/health/health.controller';

describe('HealthController', () => {
  let health: any;
  let prismaIndicator: any;
  let memory: any;
  let disk: any;
  let prisma: any;
  let fulfilment: any;
  let controller: HealthController;

  beforeEach(() => {
    health = { check: jest.fn().mockReturnValue({ status: 'ok' }) };
    prismaIndicator = { pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }) };
    memory = { checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }) };
    disk = { checkStorage: jest.fn().mockResolvedValue({ disk: { status: 'up' } }) };
    prisma = {
      outboxEvent: { count: jest.fn().mockResolvedValue(0) },
      provider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    fulfilment = { client: Promise.resolve({ ping: jest.fn().mockResolvedValue('PONG') }) };
    controller = new HealthController(health, prismaIndicator, memory, disk, prisma, fulfilment);
  });

  describe('live', () => {
    it('reports a static liveness payload without touching any dependency', () => {
      const res = controller.live();
      expect(res).toEqual({ status: 'ok', uptime: expect.any(Number), pid: process.pid });
      expect(health.check).not.toHaveBeenCalled();
      expect(prismaIndicator.pingCheck).not.toHaveBeenCalled();
    });
  });

  describe('ready', () => {
    it('checks the database and redis only', () => {
      controller.ready();
      const checks = health.check.mock.calls[0][0];
      expect(checks).toHaveLength(2);
    });

    it('wires the database ping and redis check into its closures', async () => {
      controller.ready();
      const [dbCheck, redisCheck] = health.check.mock.calls[0][0];
      await dbCheck();
      const redis = await redisCheck();
      expect(prismaIndicator.pingCheck).toHaveBeenCalledWith('database', prisma, { timeout: 3000 });
      expect(redis).toEqual({ redis: { status: 'up' } });
    });
  });

  describe('full', () => {
    it('runs the full six-way check set, exercising every closure', async () => {
      controller.full();
      const checks = health.check.mock.calls[0][0];
      expect(checks).toHaveLength(6);
      // Invoke each closure so the delegations are all covered.
      const results = await Promise.all(checks.map((c: () => unknown) => c()));
      expect(prismaIndicator.pingCheck).toHaveBeenCalledWith('database', prisma, { timeout: 3000 });
      expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 512 * 1024 * 1024);
      expect(disk.checkStorage).toHaveBeenCalledWith('disk', { path: '/', thresholdPercent: 0.9 });
      expect(results).toContainEqual({ redis: { status: 'up' } });
      expect(results).toContainEqual({ outbox: { status: 'up', pending: 0, dead: 0 } });
      expect(results).toContainEqual({ providers: { status: 'up', healthy: 0, total: 0 } });
    });
  });

  describe('checkRedis', () => {
    it('reports up when the client answers PONG', async () => {
      const result = await (controller as any).checkRedis();
      expect(result).toEqual({ redis: { status: 'up' } });
    });

    it('reports down when the client answers anything else', async () => {
      fulfilment.client = Promise.resolve({ ping: jest.fn().mockResolvedValue('nope') });
      const result = await (controller as any).checkRedis();
      expect(result).toEqual({ redis: { status: 'down' } });
    });
  });

  describe('checkOutbox', () => {
    it('is up when the backlog is small and nothing is dead', async () => {
      prisma.outboxEvent.count
        .mockResolvedValueOnce(5)  // pending
        .mockResolvedValueOnce(0); // dead
      const result = await (controller as any).checkOutbox();
      expect(result).toEqual({ outbox: { status: 'up', pending: 5, dead: 0 } });
    });

    it('throws when too many events are stalled', async () => {
      prisma.outboxEvent.count
        .mockResolvedValueOnce(150)
        .mockResolvedValueOnce(0);
      await expect((controller as any).checkOutbox()).rejects.toThrow(/150 stalled/);
    });

    it('throws when any event is parked as DEAD', async () => {
      prisma.outboxEvent.count
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(3);
      await expect((controller as any).checkOutbox()).rejects.toThrow(/3 dead/);
    });
  });

  describe('checkProviders', () => {
    it('treats no providers as healthy (nothing to sell through yet)', async () => {
      prisma.provider.findMany.mockResolvedValue([]);
      const result = await (controller as any).checkProviders();
      expect(result).toEqual({ providers: { status: 'up', healthy: 0, total: 0 } });
    });

    it('is up while at least one provider is healthy', async () => {
      prisma.provider.findMany.mockResolvedValue([
        { code: 'a', isHealthy: true },
        { code: 'b', isHealthy: false },
      ]);
      const result = await (controller as any).checkProviders();
      expect(result).toEqual({ providers: { status: 'up', healthy: 1, total: 2 } });
    });

    it('throws when providers exist but none are healthy', async () => {
      prisma.provider.findMany.mockResolvedValue([
        { code: 'a', isHealthy: false },
        { code: 'b', isHealthy: false },
      ]);
      await expect((controller as any).checkProviders()).rejects.toThrow('No healthy providers');
    });
  });
});
