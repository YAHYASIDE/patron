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
    // a refund names its own amount and where the money went
    if (data?.amount !== undefined && data?.currency) {
      variables.amount = `${Number(data.amount)} ${String(data.currency)}`;
      const where = REFUND_DESTINATIONS[String(data.destination)] ?? REFUND_DESTINATIONS.card;
      variables.destinationAr = where.ar;
      variables.destinationEn = where.en;
      variables.destinationFr = where.fr;
    }
    return variables;
  }
}

const REFUND_DESTINATIONS: Record<string, { ar: string; en: string; fr: string }> = {
  wallet: { ar: 'إلى رصيد محفظتك في المتجر', en: 'to your store wallet', fr: 'sur votre portefeuille de la boutique' },
  transfer: { ar: 'بتحويل إلى حسابك الذي دفعت منه', en: 'by transfer to the account you paid from', fr: 'par virement sur le compte qui a payé' },
  card: { ar: 'إلى بطاقتك', en: 'to your card', fr: 'sur votre carte' },
};
