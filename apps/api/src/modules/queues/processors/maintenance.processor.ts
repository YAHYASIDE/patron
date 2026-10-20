import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { QuotesService } from '../../orders/quotes.service';
import { OrdersService } from '../../orders/orders.service';
import { FxService } from '../../fx/fx.service';
import { ProvidersService } from '../../providers/providers.service';
import { WalletService } from '../../wallet/wallet.service';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { RetentionService } from '../../maintenance/retention.service';
import { RollupService } from '../../maintenance/rollup.service';
import { JOBS, QUEUES } from '../queue.constants';

/**
 * Scheduled housekeeping. Every handler is independently safe to re-run,
 * because BullMQ delivers at least once and a repeatable job can fire twice
 * across a deploy.
 *
 * Concurrency 2: these are I/O-heavy sweeps and running them in parallel with
 * each other buys nothing while competing with live traffic for the database.
 */
@Processor(QUEUES.MAINTENANCE, { concurrency: 2 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly quotes: QuotesService,
    private readonly orders: OrdersService,
    private readonly fx: FxService,
    private readonly providers: ProvidersService,
    private readonly wallet: WalletService,
    private readonly idempotency: IdempotencyService,
    private readonly rollup: RollupService,
    private readonly retention: RetentionService,
  ) {
    super();
  }

  async process(job: Job) {
    switch (job.name) {
      case JOBS.EXPIRE_QUOTES:
        return { expired: await this.quotes.expireStale() };

      case JOBS.EXPIRE_ORDERS:
        return { cancelled: await this.orders.expireUnpaid(30) };

      case JOBS.SYNC_FX: {
        const result = await this.fx.syncFromFeed();
        const stale = await this.fx.findStale();
        // Stale rates on a 604:1 pair get expensive fast — loud on purpose.
        if (stale.length) this.logger.error(`Stale FX rates: ${stale.join(', ')}`);
        return { ...result, stale };
      }

      case JOBS.PROVIDER_HEALTH:
        return { providers: await this.providers.runHealthChecks() };

      case JOBS.PURGE_IDEMPOTENCY: {
        const { count } = await this.idempotency.purgeExpired();
        return { purged: count };
      }

      case JOBS.RECONCILE_WALLETS: {
        const drift = await this.wallet.findDrift();
        // Drift means a balance was written outside the ledger. That is a bug,
        // not a data-fix — alert rather than silently correcting, because
        // correcting it destroys the evidence of how it happened.
        if (drift.length) {
          this.logger.error(`Wallet drift detected on ${drift.length} wallet(s)`, drift);
        }
        return { drift: drift.length };
      }

      case JOBS.ROLLUP_DAILY:
        // Re-rolls the last few days rather than only yesterday: a late-settling
        // payment can change a day after it closed.
        return { days: await this.rollup.rollupRecent(3) };

      case JOBS.RETENTION:
        return this.retention.runAll();

      case JOBS.TABLE_SIZES: {
        const sizes = await this.retention.tableSizes();
        this.logger.log(
          `Largest tables: ${sizes.slice(0, 5).map((t) => `${t.table}=${t.size}`).join(', ')}`,
        );
        return { tables: sizes.length };
      }

      default:
        throw new Error(`Unknown maintenance job "${job.name}"`);
    }
  }
}
