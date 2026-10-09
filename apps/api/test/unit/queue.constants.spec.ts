import {
  QUEUES,
  JOBS,
  DEFAULT_JOB_OPTS,
  FULFILMENT_JOB_OPTS,
} from '../../src/modules/queues/queue.constants';

describe('queue.constants', () => {
  it('defines one queue per failure domain', () => {
    expect(QUEUES).toEqual({
      FULFILMENT: 'fulfilment',
      NOTIFICATIONS: 'notifications',
      MAINTENANCE: 'maintenance',
    });
  });

  it('exposes stable job-name strings the emitters and processors agree on', () => {
    expect(JOBS.FULFIL_ORDER).toBe('fulfil-order');
    expect(JOBS.FULFIL_ITEM).toBe('fulfil-item');
    expect(JOBS.POLL_ITEM).toBe('poll-item');
    expect(JOBS.SEND_NOTIFICATION).toBe('send-notification');
    expect(JOBS.EXPIRE_QUOTES).toBe('expire-quotes');
    expect(JOBS.EXPIRE_ORDERS).toBe('expire-orders');
    expect(JOBS.SYNC_FX).toBe('sync-fx');
    expect(JOBS.PROVIDER_HEALTH).toBe('provider-health');
    expect(JOBS.PURGE_IDEMPOTENCY).toBe('purge-idempotency');
    expect(JOBS.RECONCILE_WALLETS).toBe('reconcile-wallets');
    expect(JOBS.ROLLUP_DAILY).toBe('rollup-daily');
    expect(JOBS.RETENTION).toBe('retention');
    expect(JOBS.TABLE_SIZES).toBe('table-sizes');
  });

  it('has no duplicate job-name values (job names route the switch statements)', () => {
    const values = Object.values(JOBS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('gives the default queue cheap-retry semantics', () => {
    expect(DEFAULT_JOB_OPTS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTS.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    // completed jobs age out, failed jobs are kept a week for inspection.
    expect(DEFAULT_JOB_OPTS.removeOnComplete).toEqual({ age: 3_600, count: 1_000 });
    expect(DEFAULT_JOB_OPTS.removeOnFail).toEqual({ age: 7 * 24 * 3_600 });
  });

  it('makes fulfilment retry fewer times and back off slower — each attempt may cost money', () => {
    expect(FULFILMENT_JOB_OPTS.attempts).toBe(3);
    expect(FULFILMENT_JOB_OPTS.attempts).toBeLessThan(DEFAULT_JOB_OPTS.attempts);
    expect(FULFILMENT_JOB_OPTS.backoff).toEqual({ type: 'exponential', delay: 15_000 });
    expect(FULFILMENT_JOB_OPTS.backoff.delay).toBeGreaterThan(DEFAULT_JOB_OPTS.backoff.delay);
  });

  it('inherits the retention/removal policy from the default opts', () => {
    expect(FULFILMENT_JOB_OPTS.removeOnComplete).toEqual(DEFAULT_JOB_OPTS.removeOnComplete);
    expect(FULFILMENT_JOB_OPTS.removeOnFail).toEqual(DEFAULT_JOB_OPTS.removeOnFail);
  });

  it('does not mutate DEFAULT_JOB_OPTS when deriving FULFILMENT_JOB_OPTS', () => {
    expect(DEFAULT_JOB_OPTS.attempts).toBe(5);
    expect(DEFAULT_JOB_OPTS.backoff.delay).toBe(5_000);
  });
});
