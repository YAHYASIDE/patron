import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';

import { QUEUES, JOBS } from './queue.constants';
import { OutboxRelay } from './outbox-relay.service';
import { FulfilmentProcessor } from './processors/fulfilment.processor';
import { NotificationsProcessor } from './processors/notifications.processor';
import { MaintenanceProcessor } from './processors/maintenance.processor';
import { MetricsCollector } from './processors/metrics.collector';
import { CHECK_WATCHES_JOB, WATCHES_QUEUE, WatchesProcessor } from './processors/watches.processor';
import { BACKUP_TICK_JOB, BACKUPS_QUEUE, BackupProcessor } from './processors/backup.processor';
import { ReportsModule } from '../reports/reports.module';

import { OrdersModule } from '../orders/orders.module';
import { ProvidersModule } from '../providers/providers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FxModule } from '../fx/fx.module';
import { WalletModule } from '../wallet/wallet.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { CustomerModule } from '../customer/customer.module';
import { AdminToolsModule } from '../admin-tools/admin-tools.module';

/**
 * In production the workers run as a separate process (`npm run start:worker`)
 * so a slow provider call never competes with API request latency, and workers
 * can be scaled and restarted independently.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('redis.host'),
          port: config.get('redis.port'),
          password: config.get('redis.password'),
          maxRetriesPerRequest: null,
        },
        /**
         * BullMQ's native telemetry interface rather than a monkey-patching
         * instrumentation package. Producer and consumer spans are linked
         * automatically, so a job's span is a child of the HTTP request that
         * enqueued it — even across processes.
         */
        telemetry: config.get('otel.enabled')
          ? new BullMQOtel('patron', process.env.APP_VERSION ?? '0.0.0')
          : undefined,
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUES.FULFILMENT },
      { name: QUEUES.NOTIFICATIONS },
      { name: QUEUES.MAINTENANCE },
      { name: WATCHES_QUEUE },
      { name: BACKUPS_QUEUE },
    ),
    OrdersModule,
    ProvidersModule,
    NotificationsModule,
    FxModule,
    WalletModule,
    ReportsModule,
    MaintenanceModule,
    CustomerModule,
    AdminToolsModule,
  ],
  providers: [
    OutboxRelay,
    FulfilmentProcessor,
    NotificationsProcessor,
    MaintenanceProcessor,
    MetricsCollector,
    WatchesProcessor,
    BackupProcessor,
  ],
  exports: [BullModule],
})
export class QueuesModule implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUES.MAINTENANCE) private maintenance: Queue,
    @InjectQueue(WATCHES_QUEUE) private watches: Queue,
    @InjectQueue(BACKUPS_QUEUE) private backups: Queue,
  ) {}

  /** Repeatable jobs are idempotent by key — re-registering on deploy is safe. */
  async onModuleInit() {
    /**
     * Skipped under test. This writes repeatable-job definitions to Redis on
     * every boot; in e2e that turns a missing or slow Redis into a bootstrap
     * failure for the entire suite, and schedules background work that
     * interferes with assertions. Tests invoke processors directly.
     */
    if (process.env.NODE_ENV === 'test') return;

    const schedule: Array<[string, string]> = [
      [JOBS.EXPIRE_QUOTES, '*/1 * * * *'],
      [JOBS.EXPIRE_ORDERS, '*/5 * * * *'],
      [JOBS.SYNC_FX, '0 * * * *'],
      [JOBS.PROVIDER_HEALTH, '*/2 * * * *'],
      [JOBS.PURGE_IDEMPOTENCY, '0 3 * * *'],
      [JOBS.RECONCILE_WALLETS, '0 4 * * *'],
      // Order matters: roll up first, then prune. Retention must never delete
      // a day that has not been aggregated yet.
      [JOBS.ROLLUP_DAILY, '15 1 * * *'],
      [JOBS.RETENTION, '30 3 * * *'],
      [JOBS.TABLE_SIZES, '0 6 * * *'],
    ];

    for (const [name, pattern] of schedule) {
      await this.maintenance.add(name, {}, {
        repeat: { pattern },
        jobId: `cron-${name}`,
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      });
    }

    // Price-drop and back-in-stock alerts, hourly; off the hour so it does not
    // land on the FX sync.
    await this.watches.add(CHECK_WATCHES_JOB, {}, {
      repeat: { pattern: '20 * * * *' },
      jobId: `cron-${CHECK_WATCHES_JOB}`,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    });

    // Scheduled backups to Google Drive. The tick reads the owner's schedule (a
    // setting), so changing the hour or switching a copy on needs no new job;
    // off the quarter hours so it does not land on the other sweeps.
    await this.backups.add(BACKUP_TICK_JOB, {}, {
      repeat: { pattern: '7,22,37,52 * * * *' },
      jobId: `cron-${BACKUP_TICK_JOB}`,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    });
  }
}
