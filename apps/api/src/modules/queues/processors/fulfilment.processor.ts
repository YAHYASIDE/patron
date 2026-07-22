import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProviderEngine } from '../../providers/provider-engine.service';
import { OrdersService } from '../../orders/orders.service';
import { JOBS, QUEUES } from '../queue.constants';
import { TracingService } from '../../../common/tracing/tracing.service';
import { RequestContextStore } from '../../../common/context/request-context';

/**
 * Every handler here is idempotent. BullMQ guarantees at-least-once delivery,
 * so a retry after a worker timeout will re-run work that may already have
 * succeeded — the engine's conditional claim makes that harmless.
 *
 * Concurrency is deliberately modest: each job may spend real money, and
 * providers rate-limit.
 */
@Processor(QUEUES.FULFILMENT, { concurrency: 5 })
export class FulfilmentProcessor extends WorkerHost {
  private readonly logger = new Logger(FulfilmentProcessor.name);

  constructor(
    private prisma: PrismaService,
    private engine: ProviderEngine,
    private orders: OrdersService,
    private tracing: TracingService,
  ) {
    super();
  }

  async process(job: Job) {
    // Establish request context inside the worker so log lines from this job
    // carry the same correlation id as the HTTP request that caused it.
    return RequestContextStore.run(
      { correlationId: this.tracing.traceId() ?? String(job.id), jobId: String(job.id) },
      () =>
        this.tracing.withSpan(
          `fulfilment.${job.name}`,
          { 'patron.job_id': String(job.id), 'patron.attempt': job.attemptsMade + 1 },
          async () => {
            switch (job.name) {
              case JOBS.FULFIL_ORDER:
                return this.fulfilOrder(job.data.orderId);
              case JOBS.FULFIL_ITEM:
                return this.fulfilItem(job.data.orderItemId, job.data.providerId);
              case JOBS.POLL_ITEM:
                return this.pollItem(job.data.orderItemId);
              default:
                throw new Error(`Unknown job "${job.name}"`);
            }
          },
        ),
    );
  }

  private async fulfilOrder(orderId: string) {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { select: { id: true, status: true } } },
    });

    // Only fulfil paid orders. A refunded or cancelled order that had a job
    // queued before the state changed must not be delivered.
    if (!['PAID', 'PROCESSING'].includes(order.status)) {
      this.logger.warn(`Skipping fulfilment for order ${orderId} in status ${order.status}`);
      return { skipped: order.status };
    }

    const pending = order.items.filter((i) => ['PENDING', 'FAILED'].includes(i.status));
    for (const item of pending) {
      await this.engine.fulfilItem(item.id).catch((err) =>
        this.logger.error(`Item ${item.id} failed: ${(err as Error).message}`),
      );
    }

    await this.orders.syncStatus(orderId);
    return { processed: pending.length };
  }

  private async fulfilItem(orderItemId: string, providerId?: string) {
    const result = await this.engine.fulfilItem(orderItemId, providerId);
    const item = await this.prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: { orderId: true },
    });
    await this.orders.syncStatus(item.orderId);
    return result;
  }

  private async pollItem(orderItemId: string) {
    const result = await this.engine.pollItem(orderItemId);
    const item = await this.prisma.orderItem.findUniqueOrThrow({
      where: { id: orderItemId },
      select: { orderId: true },
    });
    await this.orders.syncStatus(item.orderId);
    return result;
  }
}
