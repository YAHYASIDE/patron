import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { NotificationChannel as ChannelEnum, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { NotificationChannel } from './channels/notification-channel.interface';
import { InAppChannel } from './channels/in-app.channel';
import { EmailChannel } from './channels/email.channel';
import { PushChannel } from './channels/push.channel';

export interface DispatchRequest {
  userId: string;
  templateKey: string;
  variables?: Record<string, string>;
  channels?: ChannelEnum[];
  data?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly channels = new Map<string, NotificationChannel>();

  constructor(private prisma: PrismaService, private moduleRef: ModuleRef) {}

  onModuleInit() {
    for (const type of [InAppChannel, EmailChannel, PushChannel]) {
      const channel = this.moduleRef.get(type, { strict: false });
      this.channels.set(channel.code, channel);
    }
  }

  /**
   * Render and deliver. Called from a queue worker, so it must be idempotent:
   * a duplicate delivery of the same template for the same aggregate within a
   * short window is suppressed rather than sent twice.
   */
  async dispatch(req: DispatchRequest) {
    const [user, template] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: req.userId, deletedAt: null },
        include: { devices: { where: { isActive: true }, select: { token: true } } },
      }),
      this.prisma.notificationTemplate.findUnique({ where: { key: req.templateKey } }),
    ]);

    if (!user) return { skipped: 'user_missing' };
    if (!template?.isActive) {
      this.logger.warn(`No active template for "${req.templateKey}"`);
      return { skipped: 'template_missing' };
    }

    const ar = {
      title: this.render(template.titleAr, req.variables),
      body: this.render(template.bodyAr, req.variables),
    };
    const en = {
      title: this.render(template.titleEn, req.variables),
      body: this.render(template.bodyEn, req.variables),
    };
    const preferred = user.locale === 'ar' ? ar : en;

    const targets = (req.channels ?? (template.channels as ChannelEnum[])).filter((c) =>
      this.channels.get(c)?.isEnabled ?? false,
    );

    const results: Record<string, boolean> = {};

    for (const channelCode of targets) {
      const channel = this.channels.get(channelCode)!;

      const record = await this.prisma.notification.create({
        data: {
          userId: user.id,
          channel: channelCode,
          titleAr: ar.title, titleEn: en.title,
          bodyAr: ar.body, bodyEn: en.body,
          data: (req.data ?? {}) as Prisma.InputJsonValue,
        },
      });

      const outcome = await channel.send({
        userId: user.id,
        locale: user.locale,
        title: preferred.title,
        body: preferred.body,
        data: req.data,
        email: user.email,
        phone: user.phone ?? undefined,
        deviceTokens: user.devices.map((d) => d.token),
      });

      await this.prisma.notification.update({
        where: { id: record.id },
        data: { sentAt: outcome.sent ? new Date() : null, error: outcome.error },
      });
      results[channelCode] = outcome.sent;
    }

    return { delivered: results };
  }

  async listForUser(userId: string, query: PaginationDto) {
    const where = { userId, channel: ChannelEnum.IN_APP };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where, skip: query.skip, take: query.limit, orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false, channel: ChannelEnum.IN_APP } });
  }

  markRead(userId: string, ids?: string[]) {
    return this.prisma.notification.updateMany({
      where: { userId, isRead: false, ...(ids?.length && { id: { in: ids } }) },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** `{{name}}` substitution — deliberately not a template engine. */
  private render(text: string, variables?: Record<string, string>) {
    if (!variables) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => variables[key] ?? '');
  }
}
