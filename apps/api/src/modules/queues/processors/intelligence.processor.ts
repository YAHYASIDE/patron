import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ScannersService } from '../../intelligence/scanners/scanners.service';

/** Its own queue, like `watches` and `backups`: a processor sharing `maintenance` would take jobs that are not its own. */
export const INTELLIGENCE_QUEUE = 'intelligence';
export const INTEL_SCAN_JOB = 'intel-scan';
/** Daily, off the hour and away from the 03:00/03:30 sweeps. */
export const INTEL_SCAN_PATTERN = '17 3 * * *';

/**
 * Runs every in-app scanner once a day (the summary warns when a scanner has
 * not run for 2 days). Concurrency 1; safe to re-run, since discoveries are
 * upserted by fingerprint and a second pass only bumps `seenCount`.
 */
@Processor(INTELLIGENCE_QUEUE, { concurrency: 1 })
export class IntelligenceProcessor extends WorkerHost {
  constructor(private readonly scanners: ScannersService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== INTEL_SCAN_JOB) throw new Error(`Unknown intelligence job "${job.name}"`);
    const { run, created, updated } = await this.scanners.runAll('schedule');
    return { run: run.id, status: run.status, created, updated };
  }
}
