import { Prisma } from '@prisma/client';
import { FxService } from '../../src/modules/fx/fx.service';

describe('FxService', () => {
  let prisma: any;
  let config: any;
  let service: FxService;

  beforeEach(() => {
    prisma = {
      fxRate: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'r1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      currency: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    config = {
      get: jest.fn((k: string) => ({ 'currency.base': 'USD' } as Record<string, unknown>)[k]),
    };
    service = new FxService(prisma, config);
  });

  describe('recordRate', () => {
    it('records an active rate against the base currency with the given source', async () => {
      const res: any = await service.recordRate('EUR', 0.92, 'MANUAL', 'admin-1');

      const { data } = prisma.fxRate.create.mock.calls[0][0];
      expect(data.baseCurrency).toBe('USD');
      expect(data.quoteCurrency).toBe('EUR');
      expect(data.source).toBe('MANUAL');
      expect(data.isActive).toBe(true);
      expect(data.createdById).toBe('admin-1');
      expect(new Prisma.Decimal(data.rate).toString()).toBe('0.92');
      expect(res.quoteCurrency).toBe('EUR');
    });

    it('falls back to USD as base when currency.base is unset', async () => {
      config.get.mockReturnValue(undefined);
      await service.recordRate('GBP', 0.8);
      expect(prisma.fxRate.create.mock.calls[0][0].data.baseCurrency).toBe('USD');
    });

    it('refuses a zero or negative rate', async () => {
      await expect(service.recordRate('EUR', 0)).rejects.toThrow(/non-positive/);
      await expect(service.recordRate('EUR', -1)).rejects.toThrow(/non-positive/);
      expect(prisma.fxRate.create).not.toHaveBeenCalled();
    });

    it('records a suspicious >15% jump as inactive for operator review', async () => {
      prisma.fxRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal(100) });

      await service.recordRate('EUR', 130); // +30%

      expect(prisma.fxRate.create.mock.calls[0][0].data.isActive).toBe(false);
    });

    it('keeps a move within the 15% band active', async () => {
      prisma.fxRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal(100) });

      await service.recordRate('EUR', 110); // +10%

      expect(prisma.fxRate.create.mock.calls[0][0].data.isActive).toBe(true);
    });

    it('has no prior rate to compare against on the first record, so stays active', async () => {
      prisma.fxRate.findFirst.mockResolvedValue(null);
      await service.recordRate('EUR', 5000);
      expect(prisma.fxRate.create.mock.calls[0][0].data.isActive).toBe(true);
    });
  });

  describe('syncFromFeed', () => {
    afterEach(() => {
      // @ts-expect-error test cleanup
      delete global.fetch;
    });

    it('returns updated:0 and does not fetch when no feed is configured', async () => {
      config.get.mockImplementation((k: string) => (k === 'currency.base' ? 'USD' : undefined));
      global.fetch = jest.fn() as any;

      const res = await service.syncFromFeed();

      expect(res).toEqual({ updated: 0 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('records a rate for every currency the feed returns', async () => {
      config.get.mockImplementation((k: string) =>
        ({ 'currency.base': 'USD', 'currency.feedUrl': 'https://feed' } as Record<string, unknown>)[k],
      );
      prisma.currency.findMany.mockResolvedValue([{ code: 'EUR' }, { code: 'GBP' }]);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.92, GBP: 0.8 } }),
      }) as any;

      const res = await service.syncFromFeed();

      expect(global.fetch).toHaveBeenCalledWith('https://feed?base=USD');
      expect(res).toEqual({ updated: 2 });
      expect(prisma.fxRate.create).toHaveBeenCalledTimes(2);
      expect(prisma.fxRate.create.mock.calls[0][0].data.source).toBe('FEED');
    });

    it('skips currencies the feed omits without failing the sync', async () => {
      config.get.mockImplementation((k: string) =>
        ({ 'currency.base': 'USD', 'currency.feedUrl': 'https://feed' } as Record<string, unknown>)[k],
      );
      prisma.currency.findMany.mockResolvedValue([{ code: 'EUR' }, { code: 'XOF' }]);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rates: { EUR: 0.92 } }),
      }) as any;

      const res = await service.syncFromFeed();

      expect(res).toEqual({ updated: 1 });
      expect(prisma.fxRate.create).toHaveBeenCalledTimes(1);
    });

    it('throws when the feed responds with a non-ok status', async () => {
      config.get.mockImplementation((k: string) =>
        ({ 'currency.base': 'USD', 'currency.feedUrl': 'https://feed' } as Record<string, unknown>)[k],
      );
      prisma.currency.findMany.mockResolvedValue([{ code: 'EUR' }]);
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;

      await expect(service.syncFromFeed()).rejects.toThrow(/503/);
    });
  });

  describe('findStale', () => {
    it('flags currencies with no active rate at all', async () => {
      prisma.currency.findMany.mockResolvedValue([{ code: 'EUR' }, { code: 'GBP' }]);
      prisma.fxRate.findFirst.mockResolvedValue(null);

      expect(await service.findStale()).toEqual(['EUR', 'GBP']);
    });

    it('flags a rate older than the max age but not a fresh one', async () => {
      prisma.currency.findMany.mockResolvedValue([{ code: 'EUR' }, { code: 'GBP' }]);
      prisma.fxRate.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(
          where.quoteCurrency === 'EUR'
            ? { effectiveAt: new Date(Date.now() - 10 * 60_000) } // fresh
            : { effectiveAt: new Date(Date.now() - 999 * 60_000) }, // stale
        ),
      );

      expect(await service.findStale(180)).toEqual(['GBP']);
    });
  });

  describe('history', () => {
    it('reads newest-first, scoped to base+quote, honouring take', () => {
      service.history('EUR', 10);
      expect(prisma.fxRate.findMany).toHaveBeenCalledWith({
        where: { baseCurrency: 'USD', quoteCurrency: 'EUR' },
        orderBy: { effectiveAt: 'desc' },
        take: 10,
      });
    });
  });
});
