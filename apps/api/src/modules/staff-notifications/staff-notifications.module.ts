import { Global, Module } from '@nestjs/common';
import { StaffNotificationsService } from './staff-notifications.service';

/** The owner's notification inbox. Global: any module can raise a notice. */
@Global()
@Module({
  controllers: [],
  providers: [StaffNotificationsService],
  exports: [StaffNotificationsService],
})
export class StaffNotificationsModule {}
