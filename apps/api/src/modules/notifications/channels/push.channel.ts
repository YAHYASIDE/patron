import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, OutboundNotification } from './notification-channel.interface';

@Injectable()
export class PushChannel implements NotificationChannel {
  readonly code = 'PUSH' as const;
  private readonly logger = new Logger(PushChannel.name);

  constructor(private config: ConfigService) {}

  get isEnabled() {
    return !!this.config.get<string>('notifications.fcmServerKey');
  }

  async send(notification: OutboundNotification) {
    if (!notification.deviceTokens?.length) return { sent: false, error: 'No registered devices' };
    if (!this.isEnabled) return { sent: false, error: 'Push channel is not configured' };

    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          authorization: `key=${this.config.get('notifications.fcmServerKey')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          registration_ids: notification.deviceTokens,
          notification: { title: notification.title, body: notification.body },
          data: notification.data ?? {},
        }),
      });
      if (!res.ok) return { sent: false, error: `FCM returned ${res.status}` };
      return { sent: true };
    } catch (err) {
      return { sent: false, error: (err as Error).message };
    }
  }
}
