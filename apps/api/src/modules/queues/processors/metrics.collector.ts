import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { MetricsService } from '../../../common/metrics/metrics.service';
import { QUEUES } from '../queue.constants';

/**
 * Periodically samples state that has no natural event to hook into: queue
 * depth, outbox backlog, provider health, FX staleness.
 *
 * These are the gauges that answer "is the system healthy right now", as
 * opposed to the counters that answer "what happened".
 */
@Injectable()
export class MetricsCollector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollector.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private prisma: PrismaService,
    private metrics: MetricsService,
    @InjectQueue(QUEUES.FULFILMENT) private fulfilment: Queue,
    @InjectQueue(QUEUES.NOTIFICATIONS) private notifications: Queue,
    @InjectQueue(QUEUES.MAINTENANCE) private maintenance: Queue,
  ) {}

  onModuleInit() {
    // Sampling gauges during tests adds database load and no signal.
    if (process.env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => void this.collect(), 15_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async collect() {
    try {
      await Promise.all([this.collectQueues(), this.collectOutbox(), this.collectProviders(), this.collectFx()]);
    } catch (err) {
      this.logger.warn(`Metrics collection failed: ${(err as Error).message}`);
    }
  }

  private async collectQueues() {
    const queues = [
      [QUEUES.FULFILMENT, this.fulfilment],
      [QUEUES.NOTIFICATIONS, this.notifications],
      [QUEUES.MAINTENANCE, this.maintenance],
    ] as const;

    for (const [name, queue] of queues) {
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
      for (const [state, value] of Object.entries(counts)) {
        this.metrics.queueDepth.set({ queue: name, state }, value);
      }
      // A stale heartbeat with a rising waiting count means the worker is dead
      // or stuck on a poisoned job — that distinction decides restart vs debug.
      this.metrics.workerHeartbeat.set({ queue: name }, Math.floor(Date.now() / 1000));
    }
  }

  private async collectOutbox() {
    const [pending, dead] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING' } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
    ]);
    this.metrics.outboxPending.set(pending);
    this.metrics.outboxDead.set(dead);
  }

  private async collectProviders() {
    const providers = await this.prisma.provider.findMany({
      where: { isActive: true },
      select: { code: true, isHealthy: true, balance: true },
    });
    for (const p of providers) {
      this.metrics.providerHealthy.set({ provider: p.code }, p.isHealthy ? 1 : 0);
      this.metrics.providerBalance.set({ provider: p.code }, Number(p.balance));
    }
  }

  private async collectFx() {
    const rates = await this.prisma.$queryRaw<Array<{ quoteCurrency: string; age: number }>>`
      SELECT DISTINCT ON ("quoteCurrency") "quoteCurrency",
             EXTRACT(EPOCH FROM (NOW() - "effectiveAt")) AS age
      FROM "fx_rates" WHERE "isActive"
      ORDER BY "quoteCurrency", "effectiveAt" DESC
    `;
    for (const rate of rates) {
      this.metrics.fxRateAge.set({ currency: rate.quoteCurrency }, Number(rate.age));
    }
  }
}
