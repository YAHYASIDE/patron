import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationChannel, OutboundNotification } from './notification-channel.interface';

@Injectable()
export class EmailChannel implements NotificationChannel {
  readonly code = 'EMAIL' as const;
  private readonly logger = new Logger(EmailChannel.name);

  constructor(private config: ConfigService) {}

  get isEnabled() {
    return !!this.config.get<string>('notifications.emailApiKey');
  }

  async send(notification: OutboundNotification) {
    if (!notification.email) return { sent: false, error: 'No email address on file' };

    if (!this.isEnabled) {
      // Explicitly not silently succeeding — a disabled channel that reports
      // success hides broken delivery for months.
      this.logger.warn(`Email channel disabled; would have sent "${notification.title}" to ${notification.email}`);
      return { sent: false, error: 'Email channel is not configured' };
    }

    try {
      const res = await fetch(this.config.getOrThrow<string>('notifications.emailEndpoint'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.get('notifications.emailApiKey')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.get('notifications.emailFrom'),
          to: notification.email,
          subject: notification.title,
          text: notification.body,
        }),
      });
      if (!res.ok) return { sent: false, error: `Provider returned ${res.status}` };
      return { sent: true };
    } catch (err) {
      return { sent: false, error: (err as Error).message };
    }
  }
}
