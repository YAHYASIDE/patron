import { Injectable } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { BroadcastDto } from './admin-tools.dto';

const CHUNK = 1000;

/**
 * Message every customer (#48): one IN_APP notification row each, shown in the
 * store's bell. Arabic is required; English falls back to French then Arabic,
 * and French goes in `data.fr` like every other server notification.
 */
@Injectable()
export class BroadcastService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async send(dto: BroadcastDto, actorId: string) {
    const recipients = await this.prisma.user.findMany({
      where: {
        deletedAt: null, isActive: true, isBlocked: false,
        roles: { some: { role: { name: 'customer' } } },
        ...(dto.country && { country: dto.country }),
      },
      select: { id: true },
    });

    const titleAr = dto.titleAr.trim();
    const bodyAr = dto.bodyAr.trim();
    const titleFr = dto.titleFr?.trim();
    const bodyFr = dto.bodyFr?.trim();
    const titleEn = dto.titleEn?.trim() || titleFr || titleAr;
    const bodyEn = dto.bodyEn?.trim() || bodyFr || bodyAr;
    const data = {
      type: 'broadcast',
      ...(dto.link && { link: dto.link }),
      ...((titleFr || bodyFr) && { fr: { title: titleFr || titleEn, body: bodyFr || bodyEn } }),
    } as Prisma.InputJsonValue;

    return this.prisma.$transaction(async (tx) => {
      let sent = 0;
      for (let i = 0; i < recipients.length; i += CHUNK) {
        const { count } = await tx.notification.createMany({
          data: recipients.slice(i, i + CHUNK).map((u) => ({
            userId: u.id, channel: NotificationChannel.IN_APP, titleAr, titleEn, bodyAr, bodyEn, data,
          })),
        });
        sent += count;
      }
      await this.audit.record(tx, {
        actorId, action: 'notifications.broadcast', entityType: 'Notification',
        after: { titleAr, country: dto.country ?? null, link: dto.link ?? null, sent },
      });
      return { sent };
    }, { timeout: 60_000 });
  }
}
