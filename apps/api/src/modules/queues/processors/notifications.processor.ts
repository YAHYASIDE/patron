import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JOBS, QUEUES } from '../queue.constants';

@Processor(QUEUES.NOTIFICATIONS, { concurrency: 20 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private notifications: NotificationsService, private prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    if (job.name !== JOBS.SEND_NOTIFICATION) throw new Error(`Unknown job "${job.name}"`);

    const { userId, templateKey, data } = job.data as {
      userId: string; templateKey: string; data?: Record<string, unknown>;
    };

    const variables = await this.buildVariables(data);
    return this.notifications.dispatch({ userId, templateKey, variables, data });
  }

  /** Templates reference {{orderNumber}} etc.; resolve them at send time. */
  private async buildVariables(data?: Record<string, unknown>) {
    const variables: Record<string, string> = {};
    if (data?.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: String(data.orderId) },
        select: { orderNumber: true, total: true, currency: true },
      });
      if (order) {
        variables.orderNumber = order.orderNumber;
        variables.total = order.total.toString();
        variables.currency = order.currency;
      }
    }
    return variables;
  }
}
