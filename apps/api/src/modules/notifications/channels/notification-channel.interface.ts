export interface OutboundNotification {
  userId: string;
  locale: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  email?: string;
  phone?: string;
  deviceTokens?: string[];
}

/** One implementation per delivery medium. Adding SMS is a new class only. */
export interface NotificationChannel {
  readonly code: 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';
  readonly isEnabled: boolean;
  send(notification: OutboundNotification): Promise<{ sent: boolean; error?: string }>;
}
