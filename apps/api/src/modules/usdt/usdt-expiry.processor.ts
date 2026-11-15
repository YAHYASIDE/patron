import { OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { UsdtService } from './usdt.service';

/**
 * Its own queue, like `watches`: a second processor on `maintenance` would take
 * (and fail) housekeeping jobs that are not its own.
 */
export const USDT_QUEUE = 'usdt';
export const EXPIRE_USDT_JOB = 'expire-usdt-orders';

/** Cancels unpaid USDT orders past their deadline, every five minutes. Safe to re-run. */
@Processor(USDT_QUEUE, { concurrency: 1 })
export class UsdtExpiryProcessor extends WorkerHost implements OnModuleInit {
  constructor(private readonly usdt: UsdtService, @InjectQueue(USDT_QUEUE) private readonly queue: Queue) {
    super();
  }

  /** Repeatable jobs are keyed, so registering again on every boot is harmless. Skipped under test. */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.add(EXPIRE_USDT_JOB, {}, {
      repeat: { pattern: '*/5 * * * *' },
      jobId: `cron-${EXPIRE_USDT_JOB}`,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    });
  }

  async process(job: Job) {
    if (job.name !== EXPIRE_USDT_JOB) throw new Error(`Unknown usdt job "${job.name}"`);
    return { expired: await this.usdt.expireUnpaid() };
  }
}
