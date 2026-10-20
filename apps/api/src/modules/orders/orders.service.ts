import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma, QuoteStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { AuditService } from '../../common/audit/audit.service';
import { ReferenceService } from '../../common/reference/reference.service';
import { cursorWhere, toCursorPage } from '../../common/dto/cursor.dto';
import { assertTransition, deriveOrderStatus } from './order-state.machine';
import { createdAtRange, ManualFulfilDto, QueryOrdersDto } from './dto/order.dto';

/**
 * The shape `present()` reads. Declared structurally rather than pulled from a
 * Prisma payload type because the two callers pass different `include` shapes;
 * what matters is that both carry items, inputs and results.
 */
interface PresentableOrder {
  items: Array<{
    inputs: Array<{ fieldKey: string; fieldLabel: string; value: string; isSensitive: boolean }>;
    results: Array<{
      id: string;
      resultType: string;
      viewedAt: Date | null;
      deliveredAt: Date;
      providerRef: string | null;
    }>;
  }>;
}

/** The customer-facing guide a product carries in `metadata.guide` (null when none). */
export function guideOf(metadata: Prisma.JsonValue | undefined): unknown {
  const guide = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.guide : null;
  return guide && typeof guide === 'object' ? guide : null;
}

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
    // a code the store can act on (price the cart again), with the English for logs and the API docs
    if (quote.status !== QuoteStatus.ACTIVE) {
      throw new BadRequestException({ message: 'This quote is no longer valid', error: 'QUOTE_EXPIRED' });
    }
    if (quote.expiresAt < new Date()) {
      await this.prisma.checkoutQuote.update({ where: { id: quoteId }, data: { status: QuoteStatus.EXPIRED } });
      throw new BadRequestException({ message: 'This quote has expired — please request a new price', error: 'QUOTE_EXPIRED' });
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

    const page = toCursorPage(rows, query.limit);
    return { ...page, data: page.data.map(forCustomer) };
  }

  async findAllAdmin(query: QueryOrdersDto) {
    const createdAt = createdAtRange(query.from, query.to);
    const where: Prisma.OrderWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.userId && { userId: query.userId }),
      ...(query.gateway && { payments: { some: { gateway: query.gateway } } }),
      ...(query.country && { user: { country: query.country } }),
      ...(createdAt && { createdAt }),
      ...(query.search && {
        OR: [
          { orderNumber: { contains: query.search, mode: 'insensitive' } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
          // the owner looks customers up by WhatsApp number ("22123456") or name
          { user: { phone: { contains: query.search.replace(/[^\d+]/g, '') || query.search } } },
          { user: { fullName: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const rows = await this.prisma.order.findMany({
      // the cursor goes under AND: spread at the top level, its OR replaced the search's OR from page 2 on
      where: { ...where, AND: [cursorWhere(query.cursor, query.order)] },
      take: query.limit + 1,
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      include: {
        user: { select: { id: true, email: true, fullName: true, phone: true, country: true } },
        items: true,
        payments: { select: { id: true, gateway: true, status: true, amount: true } },
      },
    });

    // rows carry every order column, so the staff note (adminNote) comes along
    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      data: page.data.map((o) => ({
        ...o,
        country: o.user.country,
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
        items: { include: { inputs: true, results: true, product: { select: { metadata: true } } } },
        payments: { select: { id: true, gateway: true, status: true, amount: true, refundedAmount: true, failureReason: true, createdAt: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (userId && order.userId !== userId) throw new ForbiddenException('This order belongs to another account');

    // the customer gets each product's how-to-use guide, not the rest of the product
    const presented = this.present(order, !!userId);
    const items = presented.items.map(({ product, ...item }) => ({ ...item, guide: guideOf(product?.metadata) }));
    if (!userId) return { ...presented, items };
    // and nothing staff-only: the owner's note, costs, provider routing, request metadata
    return { ...forCustomer(presented), items: items.map(itemForCustomer) };
  }

  /**
   * Staff view of one order: the customer, what they entered, each item's
   * delivery mode, and any manual transfer they reported. Codes stay encrypted:
   * staff deliver them, they do not need to read them back.
   */
  async findOneAdmin(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, fullName: true, phone: true, phoneVerifiedAt: true } },
        items: {
          include: {
            inputs: true,
            results: true,
            product: {
              select: {
                sku: true, delivery: true, imageUrl: true,
                // codes in stock, so the order page can offer "deliver from stock"
                _count: { select: { codes: { where: { isUsed: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } } },
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, gateway: true, status: true, amount: true, currency: true, refundedAmount: true,
            failureCode: true, failureReason: true, rawResponse: true, createdAt: true, updatedAt: true,
          },
        },
        refunds: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, amount: true, currency: true, reason: true, status: true, toWallet: true, gatewayRef: true,
            createdAt: true, processedAt: true,
            requestedBy: { select: { fullName: true } }, processedBy: { select: { fullName: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    const presented = this.present(order, false);
    // what can still be refunded: the order total less every refund not rejected
    const settled = order.payments.find((p) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status));
    const committed = order.refunds
      .filter((r) => r.status !== 'REJECTED')
      .reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));
    return {
      ...presented,
      refundable: settled ? Prisma.Decimal.max(order.total.minus(committed), 0).toString() : '0',
      refundGateway: settled?.gateway ?? null,
      // only the transfer report and review, never a gateway's raw payload
      payments: order.payments.map(({ rawResponse, ...p }) => {
        const raw = (rawResponse ?? {}) as { transfer?: unknown; review?: unknown };
        return { ...p, transfer: raw.transfer ?? null, review: raw.review ?? null };
      }),
    };
  }

  /**
   * Staff deliver a paid item by hand (MANUAL delivery, or any item a provider
   * could not fulfil). Values are encrypted like provider results; the audit
   * entry records that it happened, never the codes. The order status is then
   * re-derived, so the last delivered item completes the order.
   */
  async deliverManually(orderId: string, orderItemId: string, dto: ManualFulfilDto, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!order) throw new NotFoundException('Order not found');
      const item = order.items.find((i) => i.id === orderItemId);
      if (!item) throw new NotFoundException('This item is not part of the order');
      if (!['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'FAILED'].includes(order.status)) {
        throw new BadRequestException(
          order.status === 'PENDING_PAYMENT' ? 'This order is not paid yet' : `An order that is ${order.status} cannot be delivered`,
        );
      }

      // PAID/FAILED → PROCESSING first: the machine has no direct PAID → COMPLETED.
      if (order.status === 'PAID' || order.status === 'FAILED') {
        assertTransition(order.status, 'PROCESSING');
        await tx.order.update({ where: { id: orderId }, data: { status: 'PROCESSING', version: { increment: 1 } } });
      }

      // Conditional, so two staff delivering the same item cannot both succeed.
      const { count } = await tx.orderItem.updateMany({
        where: { id: orderItemId, status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } },
        data: { status: 'DELIVERED', deliveredAt: new Date(), lastError: null },
      });
      if (count === 0) throw new BadRequestException('This item was already delivered or cancelled');

      await tx.orderResult.createMany({
        data: dto.values.map((value) => ({
          orderItemId,
          resultType: dto.resultType ?? 'code',
          valueEnc: this.crypto.encrypt(value.trim()),
          providerRef: 'manual',
        })),
      });
      await this.audit.record(tx, {
        actorId,
        action: 'orders.fulfil_manual',
        entityType: 'OrderItem',
        entityId: orderItemId,
        after: { orderId, values: dto.values.length, resultType: dto.resultType ?? 'code' },
      });
    });

    await this.syncStatus(orderId);
    return this.findOneAdmin(orderId);
  }

  /**
   * Hand out codes from the owner's stock to each paid item that has enough of
   * them. An item without enough stock is left as it is: for staff (MANUAL) or
   * the provider engine. Codes are claimed with SKIP LOCKED, so two orders paid
   * at the same moment never receive the same code, and an item is delivered
   * all at once or not at all.
   */
  async deliverFromStock(orderId: string, actorId?: string): Promise<number> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { delivery: true } } } } },
    });
    if (!order || !['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'FAILED'].includes(order.status)) return 0;

    let delivered = 0;
    for (const item of order.items) {
      if (!['PENDING', 'FAILED'].includes(item.status) || item.product?.delivery === 'AUTO_PROVIDER') continue;

      const done = await this.prisma.$transaction(async (tx) => {
        const codes = await tx.$queryRaw<{ id: string; codeEnc: string; serialEnc: string | null }[]>`
          SELECT "id", "codeEnc", "serialEnc" FROM "product_codes"
          WHERE "productId" = ${item.productId}::uuid AND "isUsed" = false
            AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
          ORDER BY "createdAt" ASC
          LIMIT ${item.quantity}
          FOR UPDATE SKIP LOCKED`;
        if (codes.length < item.quantity) return false;

        const claimed = await tx.orderItem.updateMany({
          where: { id: item.id, status: { in: ['PENDING', 'FAILED'] } },
          data: { status: 'DELIVERED', deliveredAt: new Date(), lastError: null },
        });
        if (claimed.count === 0) return false;

        const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
        if (current.status === 'PAID' || current.status === 'FAILED') {
          assertTransition(current.status, 'PROCESSING');
          await tx.order.update({ where: { id: orderId }, data: { status: 'PROCESSING', version: { increment: 1 } } });
        }

        await tx.productCode.updateMany({
          where: { id: { in: codes.map((c) => c.id) } },
          data: { isUsed: true, usedAt: new Date(), orderItemId: item.id },
        });
        // stock and results share one key, so the ciphertext moves as it is
        await tx.orderResult.createMany({
          data: codes.flatMap((c) => [
            { orderItemId: item.id, resultType: 'code', valueEnc: c.codeEnc, providerRef: `stock:${c.id}` },
            ...(c.serialEnc ? [{ orderItemId: item.id, resultType: 'serial', valueEnc: c.serialEnc, providerRef: `stock:${c.id}` }] : []),
          ]),
        });
        await this.audit.record(tx, {
          actorId, action: 'orders.deliver_from_stock', entityType: 'OrderItem', entityId: item.id,
          after: { orderId, codes: codes.length },
        });
        return true;
      });
      if (done) delivered++;
    }

    if (delivered > 0) await this.syncStatus(orderId);
    return delivered;
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
      await this.audit.record(tx, {
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
  syncStatus(orderId: string) {
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

  cancelUnpaid(orderId: string, reason: string, actorId?: string) {
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
      await this.audit.record(tx, {
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

    // Not abandoned: an order whose customer reported a manual transfer is
    // waiting on staff, and one with any payment activity inside the window
    // (a transfer the owner just rejected, a card page just opened) gives the
    // customer the full window again from that moment, so "you can pay
    // again" is never followed by a cancellation minutes later.
    const abandoned: Prisma.OrderWhereInput = {
      status: 'PENDING_PAYMENT',
      createdAt: { lt: cutoff },
      payments: {
        none: { OR: [{ gateway: 'MANUAL', status: 'AUTHORIZED' }, { updatedAt: { gte: cutoff } }] },
      },
    };
    const stale = await this.prisma.order.findMany({
      where: abandoned,
      select: { id: true },
      take: batchSize,
      orderBy: { createdAt: 'asc' },
    });
    if (stale.length === 0) return 0;

    const cancelled = await this.prisma.$transaction(async (tx) => {
      // Row locks, so a wallet payment or an approval racing the sweep either
      // lands first (and the order is no longer abandoned) or waits for it.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "orders"
        WHERE "id" = ANY(${stale.map((o) => o.id)}::uuid[]) AND "status" = 'PENDING_PAYMENT'
        ORDER BY "id" FOR UPDATE`;
      const due = await tx.order.findMany({
        where: { id: { in: locked.map((o) => o.id) }, ...abandoned },
        select: { id: true, userId: true, couponId: true },
      });
      if (due.length === 0) return 0;
      const ids = due.map((o) => o.id);

      await tx.order.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELLED', version: { increment: 1 } } });
      await tx.orderItem.updateMany({
        where: { orderId: { in: ids }, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'CANCELLED' },
      });
      // An abandoned checkout must not burn a single-use coupon: one use back per order.
      for (const o of due) {
        if (o.couponId) await tx.coupon.update({ where: { id: o.couponId }, data: { usedCount: { decrement: 1 } } });
        // the customer is told, instead of finding a cancelled order later
        await this.outbox.emit(tx, {
          aggregate: 'Order',
          aggregateId: o.id,
          eventType: 'order.cancelled',
          payload: { orderId: o.id, userId: o.userId, status: 'CANCELLED', reason: 'unpaid' },
        });
      }
      return due.length;
    });

    this.logger.log(`Expired ${cancelled} unpaid order(s)`);
    return cancelled;
  }

  /**
   * What needs the owner now, for the dashboard: paid orders whose delivery
   * failed or is late, transfers waiting for review, and payments taken twice.
   * Each list is short (the oldest first) and each has a total.
   */
  async attention(lateMinutes = 15) {
    const late = new Date(Date.now() - lateMinutes * 60_000);
    const orderSelect = {
      id: true, orderNumber: true, status: true, total: true, currency: true, paidAt: true, createdAt: true,
      user: { select: { fullName: true, phone: true } },
    } as const;
    const minutesSince = (d: Date | null) => (d ? Math.floor((Date.now() - d.getTime()) / 60_000) : null);

    const failedWhere: Prisma.OrderWhereInput = {
      OR: [
        { status: { in: ['FAILED', 'PARTIALLY_COMPLETED'] } },
        { status: { in: ['PAID', 'PROCESSING'] }, items: { some: { status: 'FAILED' } } },
      ],
    };
    const lateWhere: Prisma.OrderWhereInput = {
      status: { in: ['PAID', 'PROCESSING'] },
      paidAt: { lt: late },
      items: { none: { status: 'FAILED' } },
    };
    const transferWhere: Prisma.PaymentWhereInput = { gateway: 'MANUAL', status: 'AUTHORIZED', updatedAt: { lt: late } };
    // Payments taken twice: the ones the payment service turned away, and any order that
    // was settled more than once before that guard existed (all but its first payment,
    // unless already refunded).
    const settled: PaymentStatus[] = ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'];
    const twice = await this.prisma.payment.groupBy({
      by: ['orderId'],
      where: { status: { in: settled } },
      having: { orderId: { _count: { gt: 1 } } },
    });
    const extra: string[] = [];
    if (twice.length) {
      const seen = new Set<string>();
      const rows = await this.prisma.payment.findMany({
        where: { orderId: { in: twice.map((t) => t.orderId) }, status: { in: settled } },
        select: { id: true, orderId: true, status: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const p of rows) {
        if (!seen.has(p.orderId)) seen.add(p.orderId);
        else if (p.status !== 'REFUNDED') extra.push(p.id);
      }
    }
    const duplicateWhere: Prisma.PaymentWhereInput = {
      OR: [{ failureCode: 'duplicate_payment', status: 'FAILED' }, ...(extra.length ? [{ id: { in: extra } }] : [])],
    };

    const [failed, failedCount, lateOrders, lateCount, transfers, transferCount, duplicates, duplicateCount] = await Promise.all([
      this.prisma.order.findMany({ where: failedWhere, select: { ...orderSelect, items: { where: { status: 'FAILED' }, select: { lastError: true }, take: 1 } }, orderBy: { paidAt: 'asc' }, take: 20 }),
      this.prisma.order.count({ where: failedWhere }),
      this.prisma.order.findMany({ where: lateWhere, select: orderSelect, orderBy: { paidAt: 'asc' }, take: 20 }),
      this.prisma.order.count({ where: lateWhere }),
      this.prisma.payment.findMany({
        where: transferWhere,
        select: { id: true, amount: true, currency: true, updatedAt: true, order: { select: orderSelect } },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      }),
      this.prisma.payment.count({ where: transferWhere }),
      this.prisma.payment.findMany({
        where: duplicateWhere,
        select: { id: true, gateway: true, amount: true, currency: true, createdAt: true, order: { select: orderSelect } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.payment.count({ where: duplicateWhere }),
    ]);

    return {
      lateMinutes,
      total: failedCount + lateCount + transferCount + duplicateCount,
      failed: {
        count: failedCount,
        items: failed.map(({ items, ...o }) => ({ ...o, minutes: minutesSince(o.paidAt), error: items[0]?.lastError ?? null })),
      },
      lateDelivery: { count: lateCount, items: lateOrders.map((o) => ({ ...o, minutes: minutesSince(o.paidAt) })) },
      waitingTransfers: {
        count: transferCount,
        items: transfers.map((p) => ({ paymentId: p.id, amount: p.amount, currency: p.currency, minutes: minutesSince(p.updatedAt), order: p.order })),
      },
      duplicatePayments: {
        count: duplicateCount,
        items: duplicates.map((p) => ({ paymentId: p.id, gateway: p.gateway, amount: p.amount, currency: p.currency, createdAt: p.createdAt, order: p.order })),
      },
    };
  }

  /** Never leak raw code values or decrypted inputs in list/detail payloads. */
  private present<T extends PresentableOrder>(order: T, maskSensitive: boolean) {
    return {
      ...order,
      items: order.items.map((item) => ({
        ...item,
        inputs: item.inputs.map((i) => ({
          fieldKey: i.fieldKey,
          fieldLabel: i.fieldLabel,
          value: i.isSensitive ? '••••' : i.value,
        })),
        results: item.results.map((r) => ({
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

/** Order columns only staff may read; the customer's API never carries them. */
const STAFF_ONLY_ORDER_FIELDS = ['adminNote', 'idempotencyKey', 'ipAddress', 'userAgent', 'fxRateId', 'quoteId', 'version'] as const;
/** Order line columns only staff may read: what it cost us and how it was routed. */
const STAFF_ONLY_ITEM_FIELDS = ['unitCost', 'plannedProviderId', 'fulfilledByProviderId', 'attemptCount', 'lastError', 'version'] as const;

function omit<T extends object>(row: T, keys: readonly string[]): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

export function forCustomer<T extends object>(order: T): T {
  return omit(order, STAFF_ONLY_ORDER_FIELDS);
}

export function itemForCustomer<T extends object>(item: T): T {
  return omit(item, STAFF_ONLY_ITEM_FIELDS);
}
