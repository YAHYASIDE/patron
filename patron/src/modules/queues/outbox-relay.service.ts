import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { OutboxService } from '../../common/outbox/outbox.service';
import { QUEUES, JOBS, FULFILMENT_JOB_OPTS, DEFAULT_JOB_OPTS } from './queue.constants';

/**
 * The fields the routing switch reads. Outbox payloads are Json in the
 * database, so this is the contract the emitters must satisfy — stating it
 * here is what makes a missing `orderId` a compile error rather than an
 * `undefined` in a BullMQ job id.
 */
interface OutboxPayload {
  orderId?: string;
  userId?: string;
  paymentId?: string;
  refundId?: string;
  status?: string;
  [key: string]: unknown;
}

/**
 * Moves committed outbox events onto BullMQ.
 *
 * This is the only place that translates domain events into jobs. Delivery is
 * at-least-once by design, which is why every processor is idempotent — the
 * alternative (exactly-once) does not exist across two systems.
 */
@Injectable()
export class OutboxRelay implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private outbox: OutboxService,
    @InjectQueue(QUEUES.FULFILMENT) private fulfilment: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) private notifications: Queue,
  ) {}

  onModuleInit() {
    /**
     * Skipped under test. An e2e run boots the whole AppModule, and a relay
     * ticking every second would publish outbox events mid-assertion — tests
     * that check "exactly one order.paid event exists" would flake depending
     * on timing. Tests drive the relay explicitly when they mean to.
     */
    if (process.env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => void this.tick(), 1_000);
    // unref: a pending interval must never be the reason the process (or a
    // Jest worker) refuses to exit.
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return; // never overlap ticks
    this.running = true;
    try {
      const events = await this.outbox.claimBatch(100);
      for (const event of events) {
        try {
          await this.publish(event);
          await this.outbox.markPublished(event.id);
        } catch (err) {
          await this.outbox.markFailed(event.id, event.attempts, (err as Error).message);
        }
      }
    } catch (err) {
      this.logger.error(`Outbox relay tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async publish(event: { id: string; eventType: string; payload: OutboxPayload }) {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'order.paid':
        // jobId derived from the event id makes a re-published event a no-op.
        await this.fulfilment.add(JOBS.FULFIL_ORDER, payload, {
          ...FULFILMENT_JOB_OPTS,
          jobId: `fulfil-${payload.orderId}`,
        });
        await this.queueNotification(payload.userId, 'order.paid', payload, event.id);
        break;

      case 'order.completed':
      case 'order.partially_completed':
      case 'order.failed':
        await this.queueNotification(payload.userId, eventType, payload, event.id);
        break;

      case 'refund.processed':
        await this.queueNotification(payload.userId, 'refund.processed', payload, event.id);
        break;

      case 'order.created':
        break; // nothing to do yet; kept for the audit trail

      default:
        this.logger.warn(`No route for outbox event type "${eventType}"`);
    }
  }

  /**
   * A notification with no recipient cannot be delivered. Emitters are expected
   * to include `userId`; if one does not, that is a bug in the emitter, so log
   * it rather than throwing and poisoning the relay.
   */
  private queueNotification(
    userId: string | undefined,
    templateKey: string,
    data: unknown,
    eventId: string,
  ) {
    if (!userId) {
      this.logger.warn(`Outbox event ${eventId} (${templateKey}) has no userId; skipping notification`);
      return Promise.resolve(null);
    }

    return this.notifications.add(
      JOBS.SEND_NOTIFICATION,
      { userId, templateKey, data },
      { ...DEFAULT_JOB_OPTS, jobId: `notify-${eventId}` },
    );
  }
}
