import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { BackupRunsService } from '../../admin-tools/backup-runs.service';

/**
 * Its own queue, like `watches`: BullMQ hands each job to one worker of the
 * queue, so a processor sharing `maintenance` would take jobs that are not its own.
 */
export const BACKUPS_QUEUE = 'backups';
export const BACKUP_TICK_JOB = 'backup-tick';

/**
 * Every 15 minutes: run the scheduled Drive copy whose slot has none yet (see
 * BackupRunsService.tick). Concurrency 1: two copies of the shop at once only
 * double the load. Safe to re-run: a slot with a good copy is skipped.
 */
@Processor(BACKUPS_QUEUE, { concurrency: 1 })
export class BackupProcessor extends WorkerHost {
  constructor(private readonly runs: BackupRunsService) {
    super();
  }

  process(job: Job) {
    if (job.name !== BACKUP_TICK_JOB) throw new Error(`Unknown backups job "${job.name}"`);
    return this.runs.tick();
  }
}
