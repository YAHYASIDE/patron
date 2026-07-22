import { Injectable } from '@nestjs/common';
import { NotificationChannel } from './notification-channel.interface';

/**
 * In-app rows are written by NotificationsService itself (it owns the record),
 * so this channel is a no-op that exists to keep the dispatch loop uniform.
 */
@Injectable()
export class InAppChannel implements NotificationChannel {
  readonly code = 'IN_APP' as const;
  readonly isEnabled = true;

  /**
   * The parameter is omitted rather than named-and-ignored: TypeScript permits
   * implementing an interface method with fewer parameters, so this satisfies
   * NotificationChannel while leaving nothing unused.
   *
   * Not `async` either — there is nothing to await, and an async function with
   * no await is a promise wrapper pretending to be I/O.
   */
  send(): Promise<{ sent: boolean }> {
    return Promise.resolve({ sent: true });
  }
}
