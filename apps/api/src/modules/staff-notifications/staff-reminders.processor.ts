import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { StaffNotificationsService } from './staff-notifications.service';

/**
 * Its own queue rather than another job on `maintenance`: BullMQ hands each job
 * to one worker of the queue, so a second processor there would take (and
 * fail) housekeeping jobs that are not its own.
 */
export const STAFF_REMINDERS_QUEUE = 'staff-reminders';
export const STAFF_REMIND_JOB = 'remind-open-notices';
/** Every 10 minutes; open URGENT notices ring again after 15 min, HIGH after 30. */
export const STAFF_REMIND_PATTERN = '*/10 * * * *';

@Processor(STAFF_REMINDERS_QUEUE, { concurrency: 1 })
export class StaffRemindersProcessor extends WorkerHost {
  constructor(private readonly staff: StaffNotificationsService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== STAFF_REMIND_JOB) throw new Error(`Unknown staff reminders job "${job.name}"`);
    return { reminded: await this.staff.remind() };
  }
}
