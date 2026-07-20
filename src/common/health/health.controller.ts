import { Controller, Get } from '@nestjs/common';
import {
  DiskHealthIndicator, HealthCheck, HealthCheckService,
  MemoryHealthIndicator, PrismaHealthIndicator,
} from '@nestjs/terminus';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../decorators/public.decorator';
import { QUEUES } from '../../modules/queues/queue.constants';

/**
 * Three distinct endpoints, because Kubernetes asks three different questions:
 *
 *  /health/live   — is the process alive? Must not depend on anything external,
 *                   or a database blip restarts every pod and makes it worse.
 *  /health/ready  — can it serve traffic? Checks dependencies; failing here
 *                   removes the pod from the load balancer without killing it.
 *  /health        — full detail, for humans and dashboards.
 */
@ApiExcludeController()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaIndicator: PrismaHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private prisma: PrismaService,
    @InjectQueue(QUEUES.FULFILMENT) private fulfilment: Queue,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime(), pid: process.pid };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma, { timeout: 3000 }),
      () => this.checkRedis(),
    ]);
  }

  @Get()
  @HealthCheck()
  full() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database', this.prisma, { timeout: 3000 }),
      () => this.checkRedis(),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
      () => this.disk.checkStorage('disk', { path: '/', thresholdPercent: 0.9 }),
      () => this.checkOutbox(),
      () => this.checkProviders(),
    ]);
  }

  private async checkRedis() {
    const client = await this.fulfilment.client;
    const pong = await client.ping();
    return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
  }

  /**
   * A backed-up outbox means committed state changes are not reaching workers —
   * paid orders silently not being fulfilled. Worth failing readiness for.
   */
  private async checkOutbox() {
    const [pending, dead] = await Promise.all([
      this.prisma.outboxEvent.count({ where: { status: 'PENDING', availableAt: { lt: new Date(Date.now() - 60_000) } } }),
      this.prisma.outboxEvent.count({ where: { status: 'DEAD' } }),
    ]);
    const healthy = pending < 100 && dead === 0;
    if (!healthy) throw new Error(`Outbox unhealthy: ${pending} stalled, ${dead} dead`);
    return { outbox: { status: 'up', pending, dead } };
  }

  private async checkProviders() {
    const providers = await this.prisma.provider.findMany({
      where: { isActive: true },
      select: { code: true, isHealthy: true },
    });
    const healthy = providers.filter((p) => p.isHealthy).length;
    // Degraded, not down: one healthy provider is enough to keep selling.
    if (providers.length > 0 && healthy === 0) throw new Error('No healthy providers');
    return { providers: { status: 'up', healthy, total: providers.length } };
  }
}
