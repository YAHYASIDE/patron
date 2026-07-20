import { Injectable } from '@nestjs/common';
import { NotificationChannel, OutboundNotification } from './notification-channel.interface';

/**
 * In-app rows are written by NotificationsService itself (it owns the record),
 * so this channel is a no-op that exists to keep the dispatch loop uniform.
 */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly code = 'IN_APP' as const;
  readonly isEnabled = true;

  async send(_notification: OutboundNotification) {
    return { sent: true };
  }
}
