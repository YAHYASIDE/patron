import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateTicketDto, TicketStatus, UpdateTicketDto } from './dto/support.dto';

/** Open requests one customer may have waiting at once. */
export const MAX_OPEN_TICKETS = 5;
const CUSTOMER_LIMIT = 50;
const ADMIN_LIMIT = 200;

const CUSTOMER_FIELDS = {
  id: true, orderId: true, subject: true, message: true, status: true, reply: true, repliedAt: true, createdAt: true,
  order: { select: { orderNumber: true } },
} satisfies Prisma.SupportTicketSelect;

type CustomerRow = Prisma.SupportTicketGetPayload<{ select: typeof CUSTOMER_FIELDS }>;

function toCustomer({ order, ...ticket }: CustomerRow) {
  return { ...ticket, orderNumber: order?.orderNumber ?? null };
}

/** Show the start of a reply in the bell; the full text is on the ticket. */
function excerpt(text: string, max = 140) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** "Problem with this order" (#16) and the owner's inbox (#43). */
@Injectable()
export class SupportService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateTicketDto) {
    if (dto.orderId) {
      const order = await this.prisma.order.findFirst({ where: { id: dto.orderId, userId }, select: { id: true } });
      if (!order) throw new NotFoundException('Order not found');
    }
    const open = await this.prisma.supportTicket.count({ where: { userId, status: 'OPEN' } });
    if (open >= MAX_OPEN_TICKETS) {
      throw new BadRequestException({ message: 'You already have requests waiting for an answer', error: 'TOO_MANY_OPEN' });
    }

    const ticket = await this.prisma.supportTicket.create({
      data: { userId, orderId: dto.orderId ?? null, subject: dto.subject, message: dto.message },
      select: CUSTOMER_FIELDS,
    });
    return toCustomer(ticket);
  }

  async listMine(userId: string) {
    const rows = await this.prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_LIMIT,
      select: CUSTOMER_FIELDS,
    });
    return rows.map(toCustomer);
  }

  // ── owner ──

  async listAdmin(status?: TicketStatus) {
    const rows = await this.prisma.supportTicket.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: ADMIN_LIMIT,
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
      },
    });
    return rows.map(({ user, ...row }) => ({ ...row, customer: user }));
  }

  /** A reply marks the request ANSWERED (unless it is closed at once) and rings the customer's bell. */
  async update(id: string, dto: UpdateTicketDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.supportTicket.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Request not found');

      const reply = dto.reply;
      const status: TicketStatus = reply
        ? dto.status === 'CLOSED' ? 'CLOSED' : 'ANSWERED'
        : dto.status ?? (before.status as TicketStatus);

      const after = await tx.supportTicket.update({
        where: { id },
        data: { status, ...(reply && { reply, repliedAt: new Date() }) },
      });
      await this.audit.record(tx, {
        actorId, action: 'support.update', entityType: 'SupportTicket', entityId: id, before, after,
      });

      if (reply) {
        await this.notifications.notify({
          userId: before.userId,
          type: 'support.reply',
          orderId: before.orderId ?? undefined,
          // the store's help page lists every request with its answer
          link: '/support',
          extra: { ticketId: id },
          ar: { title: 'ردّ على طلب المساعدة', body: `${before.subject}: ${excerpt(reply)}` },
          en: { title: 'Reply to your request', body: `${before.subject}: ${excerpt(reply)}` },
          fr: { title: 'Réponse à votre demande', body: `${before.subject} : ${excerpt(reply)}` },
        }, tx);
      }
      return after;
    });
  }
}
