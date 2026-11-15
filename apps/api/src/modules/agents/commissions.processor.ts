import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { CommissionsService } from './commissions.service';

/**
 * Its own queue, as with `watches`: BullMQ hands each job to one worker of a
 * queue, so a commission job on `notifications` could be taken (and failed) by
 * the notifications processor.
 */
export const AGENTS_QUEUE = 'agents';
export const SYNC_COMMISSION_JOB = 'sync-commission';

export interface SyncCommissionJob {
  orderId: string;
  eventType: string;
}

/** Order events → the order's commission. Safe to retry: the sync derives everything from the order. */
@Processor(AGENTS_QUEUE, { concurrency: 2 })
export class CommissionsProcessor extends WorkerHost {
  constructor(private readonly commissions: CommissionsService) {
    super();
  }

  process(job: Job<SyncCommissionJob>) {
    if (job.name !== SYNC_COMMISSION_JOB) throw new Error(`Unknown agents job "${job.name}"`);
    return this.commissions.syncOrder(job.data.orderId);
  }
}
