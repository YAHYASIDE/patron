import { RollupService } from '../../src/modules/maintenance/rollup.service';

describe('RollupService', () => {
  let prisma: any;
  let service: RollupService;

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(2),
      dailyRollup: {
        findMany: jest.fn().mockResolvedValue([{ day: new Date('2026-07-01') }]),
        findFirst: jest.fn().mockResolvedValue({ computedAt: new Date('2026-07-22T01:15:00Z') }),
      },
    };
    service = new RollupService(prisma);
  });

  describe('rollupDay', () => {
    it('normalizes the date to UTC midnight and returns the affected row count', async () => {
      // A mid-day timestamp must still bind the day boundary at 00:00:00Z.
      const affected = await service.rollupDay(new Date('2026-07-20T13:45:00Z'));

      expect(affected).toBe(2);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);

      // Tagged-template values include the UTC-midnight `day` boundary.
      const values: any[] = prisma.$executeRaw.mock.calls[0].slice(1);
      const day: Date = values.find((v) => v instanceof Date && v.getUTCHours() === 0);
      expect(day.toISOString()).toBe('2026-07-20T00:00:00.000Z');
    });
  });

  describe('rollupRecent', () => {
    it('recomputes the previous N days (default 3)', async () => {
      const spy = jest.spyOn(service, 'rollupDay').mockResolvedValue(2);

      const total = await service.rollupRecent();

      expect(spy).toHaveBeenCalledTimes(3);
      expect(total).toBe(6); // 3 days * 2 rows each
    });

    it('honours a custom day count', async () => {
      const spy = jest.spyOn(service, 'rollupDay').mockResolvedValue(1);

      const total = await service.rollupRecent(5);

      expect(spy).toHaveBeenCalledTimes(5);
      expect(total).toBe(5);
    });
  });

  describe('backfill', () => {
    it('rolls up each day in the [from, to) range and returns the day count', async () => {
      const spy = jest.spyOn(service, 'rollupDay').mockResolvedValue(0);
      const from = new Date('2026-07-01T00:00:00Z');
      const to = new Date('2026-07-04T00:00:00Z');

      const days = await service.backfill(from, to);

      expect(days).toBe(3);
      expect(spy).toHaveBeenCalledTimes(3);
    });

    it('does no work when from is not before to', async () => {
      const spy = jest.spyOn(service, 'rollupDay').mockResolvedValue(0);

      const days = await service.backfill(new Date('2026-07-04'), new Date('2026-07-01'));

      expect(days).toBe(0);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('series', () => {
    it('queries the range ordered ascending, without a currency filter', async () => {
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-08');

      await service.series(from, to);

      expect(prisma.dailyRollup.findMany).toHaveBeenCalledWith({
        where: { day: { gte: from, lt: to } },
        orderBy: { day: 'asc' },
      });
    });

    it('adds a currency filter when one is provided', async () => {
      const from = new Date('2026-07-01');
      const to = new Date('2026-07-08');

      await service.series(from, to, 'EUR');

      expect(prisma.dailyRollup.findMany).toHaveBeenCalledWith({
        where: { day: { gte: from, lt: to }, currency: 'EUR' },
        orderBy: { day: 'asc' },
      });
    });
  });

  describe('freshness', () => {
    it('returns the latest computedAt timestamp', async () => {
      const res = await service.freshness();
      expect(res).toEqual(new Date('2026-07-22T01:15:00Z'));
    });

    it('returns null when no rollups exist yet', async () => {
      prisma.dailyRollup.findFirst.mockResolvedValue(null);
      expect(await service.freshness()).toBeNull();
    });
  });
});
