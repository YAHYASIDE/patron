import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { WatchesService } from '../../customer/watches.service';

/**
 * Its own queue rather than another job on `maintenance`: BullMQ hands each job
 * to one worker of the queue, so a second processor there would take (and
 * fail) housekeeping jobs that are not its own.
 */
export const WATCHES_QUEUE = 'watches';
export const CHECK_WATCHES_JOB = 'check-watches';

/** The hourly price-drop / back-in-stock sweep (#11, #12). Safe to re-run. */
@Processor(WATCHES_QUEUE, { concurrency: 1 })
export class WatchesProcessor extends WorkerHost {
  constructor(private readonly watches: WatchesService) {
    super();
  }

  process(job: Job) {
    if (job.name !== CHECK_WATCHES_JOB) throw new Error(`Unknown watches job "${job.name}"`);
    return this.watches.runChecks();
  }
}
