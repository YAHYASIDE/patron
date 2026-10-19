import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { OrderNoteDto, UpdateCustomerDto } from './admin-tools.dto';

/** Orders that count as a sale (paid, being delivered, or done), as on the customers list. */
export const SOLD_STATUSES = ['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED'] as const;

/** The customer page (#37) and staff notes on orders (#38). */
@Injectable()
export class CustomersAdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, fullName: true, phone: true, email: true, country: true, city: true, adminNote: true, tags: true,
        phoneVerifiedAt: true, isBlocked: true, createdAt: true, lastLoginAt: true,
      },
    });
    if (!user) throw new NotFoundException('Customer not found');

    const [orders, totalOrders, sold, wallets, ledger] = await Promise.all([
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, orderNumber: true, status: true, total: true, currency: true, createdAt: true },
      }),
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.order.aggregate({
        where: { userId: id, status: { in: [...SOLD_STATUSES] } },
        _count: { _all: true },
        _sum: { totalBase: true },
        _max: { createdAt: true },
      }),
      // the customer's balances, and the ledger behind them (newest first)
      this.prisma.wallet.findMany({ where: { userId: id }, select: { currencyCode: true, balance: true, updatedAt: true } }),
      this.prisma.walletTransaction.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true, type: true, amount: true, balanceAfter: true, currency: true, description: true,
          referenceType: true, referenceId: true, createdAt: true, createdById: true,
        },
      }),
    ]);

    return {
      ...user,
      stats: {
        orders: totalOrders,
        paidOrders: sold._count._all,
        totalSpentBase: (sold._sum.totalBase ?? new Prisma.Decimal(0)).toFixed(2),
        lastOrderAt: sold._max.createdAt ?? null,
      },
      orders,
      wallets,
      ledger: await this.withStaffNames(ledger),
    };
  }

  /** Who made each manual adjustment, by name (the ledger keeps only the id). */
  private async withStaffNames<T extends { createdById: string | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
    const staff = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
      : [];
    const name = new Map(staff.map((u) => [u.id, u.fullName]));
    return rows.map(({ createdById, ...r }) => ({ ...r, by: createdById ? (name.get(createdById) ?? null) : null }));
  }

  async update(id: string, dto: UpdateCustomerDto, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: { id, deletedAt: null }, select: { adminNote: true, tags: true } });
      if (!before) throw new NotFoundException('Customer not found');

      const data: Prisma.UserUpdateInput = {};
      if (dto.adminNote !== undefined) data.adminNote = dto.adminNote?.trim() || null;
      if (dto.tags !== undefined) {
        // trimmed, empty ones dropped, each once (case-insensitive), in the order given
        const seen = new Set<string>();
        data.tags = dto.tags
          .map((t) => t.trim())
          .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
      }

      const after = await tx.user.update({ where: { id }, data, select: { adminNote: true, tags: true } });
      await this.audit.record(tx, { actorId, action: 'customers.update', entityType: 'User', entityId: id, before, after });
    });
    return this.findOne(id);
  }

  async setOrderNote(orderId: string, dto: OrderNoteDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.order.findUnique({ where: { id: orderId }, select: { adminNote: true } });
      if (!before) throw new NotFoundException('Order not found');
      const after = await tx.order.update({
        where: { id: orderId },
        data: { adminNote: dto.note?.trim() || null },
        select: { adminNote: true },
      });
      await this.audit.record(tx, { actorId, action: 'orders.note', entityType: 'Order', entityId: orderId, before, after });
      return { adminNote: after.adminNote };
    });
  }
}
