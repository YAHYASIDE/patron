import { RetentionService } from '../../src/modules/maintenance/retention.service';

describe('RetentionService', () => {
  let prisma: any;
  let service: RetentionService;

  beforeEach(() => {
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(3), // < CHUNK -> single batch
      $queryRaw: jest.fn().mockResolvedValue([{ table: 'orders', rows: 10n, size: '1 MB' }]),
      outboxEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new RetentionService(prisma);
  });

  describe('runAll', () => {
    it('runs every retention task and returns per-task deleted counts', async () => {
      const results = await service.runAll();

      expect(results).toEqual({
        outbox: 0,
        providerCalls: 3,
        auditLogs: 3,
        loginAttempts: 3,
        notifications: 3,
        verificationTokens: 3,
        refreshTokens: 3,
        idempotency: 3,
      });
      // 7 raw-SQL chunked deletes, each a single sub-CHUNK batch.
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(7);
    });

    it('isolates a failing task as -1 and keeps the others running', async () => {
      const logSpy = jest.spyOn((service as any).logger, 'error').mockImplementation(() => {});
      prisma.outboxEvent.findMany.mockRejectedValue(new Error('boom'));

      const results = await service.runAll();

      expect(results.outbox).toBe(-1);
      expect(results.providerCalls).toBe(3); // unaffected
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('passes the correct table/column into the raw delete for each task', async () => {
      await service.runAll();

      const tables = prisma.$executeRawUnsafe.mock.calls.map((c: any[]) => c[0]);
      expect(tables.some((sql: string) => sql.includes('"provider_calls"') && sql.includes('"createdAt"'))).toBe(true);
      expect(tables.some((sql: string) => sql.includes('"verification_tokens"') && sql.includes('"expiresAt"'))).toBe(true);
    });
  });

  describe('chunkedDeleteRaw', () => {
    it('loops until a batch smaller than CHUNK is returned, summing the total', async () => {
      prisma.$executeRawUnsafe.mockReset();
      prisma.$executeRawUnsafe.mockResolvedValueOnce(5000).mockResolvedValueOnce(2);

      const deleted = await (service as any).chunkedDeleteRaw('audit_logs', 'createdAt', 30);

      expect(deleted).toBe(5002);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it('binds a cutoff Date derived from the retention window', async () => {
      prisma.$executeRawUnsafe.mockReset();
      prisma.$executeRawUnsafe.mockResolvedValue(0);
      const before = Date.now();

      await (service as any).chunkedDeleteRaw('login_attempts', 'createdAt', 30);

      const cutoff: Date = prisma.$executeRawUnsafe.mock.calls[0][1];
      expect(cutoff).toBeInstanceOf(Date);
      // ~30 days in the past.
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(30 * 864e5 - 5000);
    });
  });

  describe('pruneOutbox', () => {
    it('deletes a batch of PUBLISHED events by id and returns the count', async () => {
      prisma.outboxEvent.findMany.mockResolvedValue([{ id: 'e1' }, { id: 'e2' }]);
      prisma.outboxEvent.deleteMany.mockResolvedValue({ count: 2 });

      const deleted = await (service as any).pruneOutbox(7);

      expect(deleted).toBe(2);
      expect(prisma.outboxEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['e1', 'e2'] } } });
    });

    it('returns 0 and never deletes when nothing is due', async () => {
      const deleted = await (service as any).pruneOutbox(7);

      expect(deleted).toBe(0);
      expect(prisma.outboxEvent.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('tableSizes', () => {
    it('delegates to a raw size query', async () => {
      const res = await service.tableSizes();
      expect(res).toEqual([{ table: 'orders', rows: 10n, size: '1 MB' }]);
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});
