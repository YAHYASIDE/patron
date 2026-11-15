import { MaintenanceProcessor } from '../../src/modules/queues/processors/maintenance.processor';
import { JOBS } from '../../src/modules/queues/queue.constants';

describe('MaintenanceProcessor', () => {
  let quotes: any;
  let orders: any;
  let fx: any;
  let providers: any;
  let wallet: any;
  let idempotency: any;
  let rollup: any;
  let retention: any;
  let processor: MaintenanceProcessor;

  const job = (name: string): any => ({ name, data: {}, id: '1', attemptsMade: 0 });

  beforeEach(() => {
    quotes = { expireStale: jest.fn().mockResolvedValue(4) };
    orders = { expireUnpaid: jest.fn().mockResolvedValue(2) };
    fx = {
      syncFromFeed: jest.fn().mockResolvedValue({ updated: 3 }),
      findStale: jest.fn().mockResolvedValue([]),
    };
    providers = { runHealthChecks: jest.fn().mockResolvedValue(5) };
    wallet = { findDrift: jest.fn().mockResolvedValue([]) };
    idempotency = { purgeExpired: jest.fn().mockResolvedValue({ count: 12 }) };
    rollup = { rollupRecent: jest.fn().mockResolvedValue(3) };
    retention = {
      runAll: jest.fn().mockResolvedValue({ purged: 9 }),
      tableSizes: jest.fn().mockResolvedValue([]),
    };
    processor = new MaintenanceProcessor(
      quotes, orders, fx, providers, wallet, idempotency, rollup, retention,
    );
  });

  it('expires stale quotes', async () => {
    expect(await processor.process(job(JOBS.EXPIRE_QUOTES))).toEqual({ expired: 4 });
    expect(quotes.expireStale).toHaveBeenCalledTimes(1);
  });

  it('cancels unpaid orders older than the 30-minute window', async () => {
    expect(await processor.process(job(JOBS.EXPIRE_ORDERS))).toEqual({ cancelled: 2 });
    expect(orders.expireUnpaid).toHaveBeenCalledWith(30);
  });

  describe('sync-fx', () => {
    it('merges the sync result with an empty stale list when all rates are fresh', async () => {
      const result = await processor.process(job(JOBS.SYNC_FX));
      expect(result).toEqual({ updated: 3, stale: [] });
      expect(fx.syncFromFeed).toHaveBeenCalledTimes(1);
    });

    it('loudly logs and reports stale rates', async () => {
      fx.findStale.mockResolvedValue(['USD/NGN', 'USD/GHS']);
      const errSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);

      const result = await processor.process(job(JOBS.SYNC_FX));

      expect(result).toEqual({ updated: 3, stale: ['USD/NGN', 'USD/GHS'] });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('USD/NGN, USD/GHS'));
    });
  });

  it('runs provider health checks', async () => {
    expect(await processor.process(job(JOBS.PROVIDER_HEALTH))).toEqual({ providers: 5 });
  });

  it('purges expired idempotency records and returns the count', async () => {
    expect(await processor.process(job(JOBS.PURGE_IDEMPOTENCY))).toEqual({ purged: 12 });
  });

  describe('reconcile-wallets', () => {
    it('reports zero drift without alerting when the ledger balances', async () => {
      const errSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);
      expect(await processor.process(job(JOBS.RECONCILE_WALLETS))).toEqual({ drift: 0 });
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('alerts (but does not auto-correct) when drift is detected', async () => {
      const drift = [{ walletId: 'w1' }, { walletId: 'w2' }];
      wallet.findDrift.mockResolvedValue(drift);
      const errSpy = jest.spyOn((processor as any).logger, 'error').mockImplementation(() => undefined);

      const result = await processor.process(job(JOBS.RECONCILE_WALLETS));

      expect(result).toEqual({ drift: 2 });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('2 wallet(s)'), drift);
    });
  });

  it('re-rolls the last three days of rollups', async () => {
    expect(await processor.process(job(JOBS.ROLLUP_DAILY))).toEqual({ days: 3 });
    expect(rollup.rollupRecent).toHaveBeenCalledWith(3);
  });

  it('delegates retention wholesale to runAll', async () => {
    expect(await processor.process(job(JOBS.RETENTION))).toEqual({ purged: 9 });
    expect(retention.runAll).toHaveBeenCalledTimes(1);
  });

  describe('table-sizes', () => {
    it('logs the five largest tables and returns the total count', async () => {
      retention.tableSizes.mockResolvedValue([
        { table: 'a', size: '9GB' }, { table: 'b', size: '8GB' }, { table: 'c', size: '7GB' },
        { table: 'd', size: '6GB' }, { table: 'e', size: '5GB' }, { table: 'f', size: '1GB' },
      ]);
      const logSpy = jest.spyOn((processor as any).logger, 'log').mockImplementation(() => undefined);

      const result = await processor.process(job(JOBS.TABLE_SIZES));

      expect(result).toEqual({ tables: 6 });
      const msg = logSpy.mock.calls[0][0];
      expect(msg).toContain('a=9GB');
      expect(msg).toContain('e=5GB');
      // only the top five are logged.
      expect(msg).not.toContain('f=1GB');
    });
  });

  it('throws on an unknown maintenance job so BullMQ retries/parks it', async () => {
    await expect(processor.process(job('made-up'))).rejects.toThrow('Unknown maintenance job "made-up"');
  });

  it('propagates a handler error to BullMQ rather than swallowing it', async () => {
    quotes.expireStale.mockRejectedValue(new Error('db timeout'));
    await expect(processor.process(job(JOBS.EXPIRE_QUOTES))).rejects.toThrow('db timeout');
  });
});
