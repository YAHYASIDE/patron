import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, QuoteStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { AuditService } from '../../common/audit/audit.service';
import { ReferenceService } from '../../common/reference/reference.service';
import { cursorWhere, toCursorPage } from '../../common/dto/cursor.dto';
import { assertTransition, deriveOrderStatus } from './order-state.machine';
import { QueryOrdersDto } from './dto/order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private outbox: OutboxService,
    private audit: AuditService,
    private reference: ReferenceService,
  ) {}

  /**
   * Turn a quote into an order. Every monetary value is copied from the quote —
   * nothing is recalculated, so the customer pays exactly what was shown.
   *
   * The quote is consumed with a conditional update: only one request can flip
   * ACTIVE → CONSUMED, so a double-tapped checkout produces one order even if
   * the idempotency layer is bypassed.
   */
  async createFromQuote(userId: string, quoteId: string, meta: { ip?: string; userAgent?: string }) {
    const quote = await this.prisma.checkoutQuote.findUnique({
      where: { id: quoteId },
      include: { items: { include: { inputs: true } } },
    });

    if (!quote) throw new NotFoundException('Quote not found');
    if (quote.userId !== userId) throw new ForbiddenException('This quote belongs to another account');
    if (quote.status === QuoteStatus.CONSUMED) {
      const existing = await this.prisma.order.findUnique({ where: { quoteId } });
      if (existing) return this.findOne(existing.id, userId);
    }
    if (quote.status !== QuoteStatus.ACTIVE) throw new BadRequestException('This quote is no longer valid');
    if (quote.expiresAt < new Date()) {
      await this.prisma.checkoutQuote.update({ where: { id: quoteId }, data: { status: QuoteStatus.EXPIRED } });
      throw new BadRequestException('This quote has expired — please request a new price');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.checkoutQuote.updateMany({
        where: { id: quoteId, status: QuoteStatus.ACTIVE, expiresAt: { gt: new Date() } },
        data: { status: QuoteStatus.CONSUMED, consumedAt: new Date() },
      });
      if (claimed.count === 0) throw new BadRequestException('This quote has already been used or expired');

      const created = await tx.order.create({
        data: {
          orderNumber: await this.reference.order(tx),
          userId,
          quoteId,
          status: OrderStatus.PENDING_PAYMENT,
          // ── frozen values, copied verbatim ──
          subtotal: quote.subtotal,
          discount: quote.discount,
          fees: quote.fees,
          taxAmount: quote.taxAmount,
          taxRate: quote.taxRate,
          taxInclusive: quote.taxInclusive,
          total: quote.total,
          currency: quote.currency,
          baseCurrency: quote.baseCurrency,
          fxRate: quote.fxRate,
          fxRateId: quote.fxRateId,
          totalBase: quote.totalBase,
          couponId: quote.couponId,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
          items: {
            create: quote.items.map((qi) => ({
              productId: qi.productId,
              productNameAr: qi.productNameAr,
              productNameEn: qi.productNameEn,
              quantity: qi.quantity,
              unitPrice: qi.unitPrice,
              unitCost: qi.unitCostBase,
              lineTotal: qi.lineTotal,
              taxAmount: qi.taxAmount,
              plannedProviderId: qi.plannedProviderId,
              inputs: {
                create: qi.inputs.map((input) => ({
                  fieldKey: input.fieldKey,
                  fieldLabel: input.fieldLabel,
                  value: input.value, // already encrypted if sensitive
                  isSensitive: input.isSensitive,
                })),
              },
            })),
          },
        },
        include: { items: true },
      });

      if (quote.couponId) {
        await tx.coupon.update({ where: { id: quote.couponId }, data: { usedCount: { increment: 1 } } });
      }

      await this.outbox.emit(tx, {
        aggregate: 'Order',
        aggregateId: created.id,
        eventType: 'order.created',
        payload: { orderId: created.id, userId, total: created.total.toString(), currency: created.currency },
      });

      return created;
    });

    return this.findOne(order.id, userId);
  }

  /**
   * Cursor-paginated: a customer's order history grows without bound, and
   * OFFSET plus COUNT would degrade for the platform's best customers first.
   */
  async findAllForUser(userId: string, query: QueryOrdersDto) {
    const rows = await this.prisma.order.findMany({
      where: { userId, ...(query.status && { status: query.status }), ...cursorWhere(query.cursor, query.order) },
      take: query.limit + 1, // the extra row decides hasMore without a COUNT
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      include: {
        items: { select: { id: true, productNameAr: true, productNameEn: true, quantity: true, status: true } },
      },
    });

    return toCursorPage(rows, query.limit);
  }

  async findAllAdmin(query: QueryOrdersDto) {
    const where: Prisma.OrderWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.userId && { userId: query.userId }),
      ...(query.search && {
        OR: [
          { orderNumber: { contains: query.search, mode: 'insensitive' } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const rows = await this.prisma.order.findMany({
      where: { ...where, ...cursorWhere(query.cursor, query.order) },
      take: query.limit + 1,
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      include: {
        user: { select: { id: true, email: true, fullName: true } },
        items: true,
        payments: { select: { id: true, gateway: true, status: true, amount: true } },
      },
    });

    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      data: page.data.map((o) => ({
        ...o,
        // Margin is knowable per order because cost was frozen at quote time.
        marginBase: o.items.reduce(
          (acc, i) => acc.plus(i.unitPrice.div(o.fxRate).minus(i.unitCost).mul(i.quantity)),
          new Prisma.Decimal(0),
        ),
      })),
    };
  }

  async findOne(id: string, userId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: { include: { inputs: true, results: true } },
        payments: { select: { id: true, gateway: true, status: true, amount: true, createdAt: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (userId && order.userId !== userId) throw new ForbiddenException('This order belongs to another account');

    return this.present(order, !!userId);
  }

  /**
   * Reveal a delivered code. Decryption is a separate, audited call rather than
   * part of the order payload — codes should not sit in every list response,
   * browser cache and log line.
   */
  async revealResult(orderItemId: string, userId: string) {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: true, results: true },
    });
    if (!item) throw new NotFoundException('Order item not found');
    if (item.order.userId !== userId) throw new ForbiddenException('This order belongs to another account');
    if (item.status !== 'DELIVERED') throw new BadRequestException('This item has not been delivered yet');

    await this.prisma.$transaction(async (tx) => {
      await tx.orderResult.updateMany({
        where: { orderItemId, viewedAt: null },
        data: { viewedAt: new Date() },
      });
      await this.audit.recordIn(tx, {
        actorId: userId, action: 'orders.reveal_result', entityType: 'OrderItem', entityId: orderItemId,
      });
    });

    return item.results.map((r) => ({
      resultType: r.resultType,
      value: this.crypto.decrypt(r.valueEnc),
      deliveredAt: r.deliveredAt,
    }));
  }

  /**
   * Recompute order status from its items. Called after every fulfilment
   * attempt; the aggregate is derived, never assigned ad hoc.
   */
  async syncStatus(orderId: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: { select: { status: true } } },
      });
      if (['PENDING_PAYMENT', 'REFUNDED', 'CANCELLED'].includes(order.status)) return order;

      const derived = deriveOrderStatus(order.items.map((i) => i.status));
      if (derived === order.status) return order;

      assertTransition(order.status, derived);

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status: derived,
          version: { increment: 1 },
          completedAt: derived === 'COMPLETED' ? new Date() : undefined,
        },
      });

      await this.outbox.emit(tx, {
        aggregate: 'Order',
        aggregateId: orderId,
        eventType: `order.${derived.toLowerCase()}`,
        payload: { orderId, userId: order.userId, status: derived },
      });

      return updated;
    });
  }

  async cancelUnpaid(orderId: string, reason: string, actorId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      assertTransition(order.status, 'CANCELLED');

      const updated = await tx.order.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await tx.orderItem.updateMany({
        where: { orderId, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'CANCELLED' },
      });
      // Releasing the coupon matters: an abandoned checkout should not burn
      // a single-use code.
      if (order.couponId) {
        await tx.coupon.update({ where: { id: order.couponId }, data: { usedCount: { decrement: 1 } } });
      }
      await this.audit.recordIn(tx, {
        actorId, action: 'orders.cancel', entityType: 'Order', entityId: orderId, after: { reason },
      });
      return updated;
    });
  }

  /**
   * Sweeper: cancel orders that were never paid.
   *
   * Batched rather than one transaction per order. At a thousand stale orders
   * the previous implementation opened a thousand transactions and held a
   * connection for the duration; this holds one, briefly.
   */
  async expireUnpaid(minutes: number, batchSize = 500) {
    const cutoff = new Date(Date.now() - minutes * 60_000);

    const stale = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } },
      select: { id: true, couponId: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    if (stale.length === 0) return 0;

    const ids = stale.map((o) => o.id);
    const couponIds = stale.map((o) => o.couponId).filter((c): c is string => !!c);

    await this.prisma.$transaction(async (tx) => {
      // Conditional on status so an order paid between the read and the write
      // is not cancelled out from under a customer who just paid.
      const cancelled = await tx.order.updateMany({
        where: { id: { in: ids }, status: 'PENDING_PAYMENT' },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await tx.orderItem.updateMany({
        where: { orderId: { in: ids }, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'CANCELLED' },
      });
      // An abandoned checkout must not burn a single-use coupon.
      for (const couponId of new Set(couponIds)) {
        await tx.coupon.update({
          where: { id: couponId },
          data: { usedCount: { decrement: 1 } },
        });
      }
      this.logger.log(`Expired ${cancelled.count} unpaid order(s)`);
    });

    return stale.length;
  }

  /** Never leak raw code values or decrypted inputs in list/detail payloads. */
  private present(order: any, maskSensitive: boolean) {
    return {
      ...order,
      items: order.items.map((item: any) => ({
        ...item,
        inputs: item.inputs.map((i: any) => ({
          fieldKey: i.fieldKey,
          fieldLabel: i.fieldLabel,
          value: i.isSensitive ? '••••' : i.value,
        })),
        results: item.results.map((r: any) => ({
          id: r.id,
          resultType: r.resultType,
          hasValue: true,
          revealed: !!r.viewedAt,
          deliveredAt: r.deliveredAt,
          ...(maskSensitive ? {} : { providerRef: r.providerRef }),
        })),
      })),
    };
  }
}
