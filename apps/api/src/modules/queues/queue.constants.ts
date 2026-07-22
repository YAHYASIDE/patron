/**
 * One queue per failure domain. A provider outage backing up fulfilment must
 * not stop password-reset emails from going out.
 */
export const QUEUES = {
  FULFILMENT: 'fulfilment',
  NOTIFICATIONS: 'notifications',
  MAINTENANCE: 'maintenance',
} as const;

export const JOBS = {
  // fulfilment
  FULFIL_ORDER: 'fulfil-order',
  FULFIL_ITEM: 'fulfil-item',
  POLL_ITEM: 'poll-item',

  // notifications
  SEND_NOTIFICATION: 'send-notification',

  // maintenance
  EXPIRE_QUOTES: 'expire-quotes',
  EXPIRE_ORDERS: 'expire-orders',
  SYNC_FX: 'sync-fx',
  PROVIDER_HEALTH: 'provider-health',
  PURGE_IDEMPOTENCY: 'purge-idempotency',
  RECONCILE_WALLETS: 'reconcile-wallets',
  ROLLUP_DAILY: 'rollup-daily',
  RETENTION: 'retention',
  TABLE_SIZES: 'table-sizes',
} as const;

/**
 * Defaults chosen per the failure mode:
 *  - fulfilment retries slowly and few times; each attempt may cost real money
 *  - notifications retry more, they are cheap and idempotent
 *  - failed jobs are kept for inspection; completed ones are aged out so Redis
 *    does not grow without bound
 */
export const DEFAULT_JOB_OPTS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
};

export const FULFILMENT_JOB_OPTS = {
  ...DEFAULT_JOB_OPTS,
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 15_000 },
};
