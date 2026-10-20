import { Global, Module, OnModuleInit } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { StaffNotificationsService } from './staff-notifications.service';
import { StaffInboxService } from './staff-inbox.service';
import { StaffEventsService } from './staff-events.service';
import { StaffNotificationsController } from './staff-notifications.controller';
import {
  STAFF_REMIND_JOB, STAFF_REMIND_PATTERN, STAFF_REMINDERS_QUEUE, StaffRemindersProcessor,
} from './staff-reminders.processor';

/** The owner's notification inbox. Global: any module can raise a notice. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: STAFF_REMINDERS_QUEUE })],
  controllers: [StaffNotificationsController],
  providers: [StaffNotificationsService, StaffInboxService, StaffEventsService, StaffRemindersProcessor],
  exports: [StaffNotificationsService, StaffEventsService],
})
export class StaffNotificationsModule implements OnModuleInit {
  constructor(@InjectQueue(STAFF_REMINDERS_QUEUE) private reminders: Queue) {}

  /** Repeatable jobs are idempotent by key — re-registering on deploy is safe. Skipped under test, like the other schedules. */
  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    await this.reminders.add(STAFF_REMIND_JOB, {}, {
      repeat: { pattern: STAFF_REMIND_PATTERN },
      jobId: `cron-${STAFF_REMIND_JOB}`,
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 200 },
    });
  }
}
