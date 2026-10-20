import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { InAppChannel } from './channels/in-app.channel';
import { EmailChannel } from './channels/email.channel';
import { PushChannel } from './channels/push.channel';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, InAppChannel, EmailChannel, PushChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
