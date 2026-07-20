import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PaymentGateway as GatewayEnum, PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { GatewayRegistry } from './gateways/gateway.registry';
import { assertTransition } from '../orders/order-state.machine';
import { MetricsService } from '../../common/metrics/metrics.service';
import { LockRank, acquireLocks } from '../../common/locking/lock-order';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private gateways: GatewayRegistry,
    private outbox: OutboxService,
    private metrics: MetricsService,
  ) {}

  /**
   * Start payment for an order. The amount is taken from the order, never from
   * the client — a client-supplied amount is how you get $0.01 orders.
   */
  async initiate(orderId: string, userId: string, gatewayCode: GatewayEnum, returnUrl?: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== userId) throw new BadRequestException('This order belongs to another account');
    if (order.status !== 'PENDING_PAYMENT') throw new BadRequestException('This order is not awaiting payment');

    // Reuse an in-flight attempt rather than creating a second charge.
    const inFlight = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['INITIATED', 'AUTHORIZED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight && inFlight.gateway === gatewayCode) {
      const verified = await this.gateways.get(gatewayCode).verify(inFlight.gatewayRef ?? '');
      if (verified.status === 'PENDING') {
        return { paymentId: inFlight.id, status: inFlight.status, gatewayRef: inFlight.gatewayRef };
      }
    }

    const gateway = this.gateways.get(gatewayCode);

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        userId,
        gateway: gatewayCode,
        amount: order.total,
        currency: order.currency,
        baseCurrency: order.baseCurrency,
        fxRate: order.fxRate,          // frozen with the order, not re-read
        amountBase: order.totalBase,
        fxRateId: order.fxRateId,
        status: PaymentStatus.INITIATED,
      },
    });

    const result = await gateway.initiate({
      paymentId: payment.id,
      orderId,
      userId,
      amount: order.total,
      currency: order.currency,
      description: `Order ${order.orderNumber}`,
      returnUrl,
      metadata: { orderNumber: order.orderNumber },
    });

    if (result.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.FAILED,
          failureCode: result.failureCode,
          failureReason: result.failureReason,
          version: { increment: 1 },
        },
      });
      throw new BadRequestException(result.failureReason);
    }

    if (result.status === 'CAPTURED') {
      await this.markCaptured(payment.id, result.gatewayRef, result.raw);
      return { paymentId: payment.id, status: 'CAPTURED' as const, gatewayRef: result.gatewayRef };
    }

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.AUTHORIZED, gatewayRef: result.gatewayRef, version: { increment: 1 } },
    });

    return {
      paymentId: payment.id,
      status: 'REQUIRES_ACTION' as const,
      gatewayRef: result.gatewayRef,
      redirectUrl: result.redirectUrl,
      clientSecret: result.clientSecret,
    };
  }

  /**
   * Confirm with the gateway directly. The client telling us it paid is not
   * evidence; only the gateway's own answer moves an order to PAID.
   */
  async confirm(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status === PaymentStatus.CAPTURED) return { status: 'CAPTURED' as const };
    if (!payment.gatewayRef) throw new BadRequestException('This payment was never submitted to a gateway');

    const verified = await this.gateways.get(payment.gateway).verify(payment.gatewayRef);

    if (verified.status === 'CAPTURED') {
      await this.markCaptured(payment.id, payment.gatewayRef, verified.raw);
      return { status: 'CAPTURED' as const };
    }
    if (verified.status === 'FAILED') {
      await this.prisma.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, rawResponse: verified.raw as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      return { status: 'FAILED' as const };
    }
    return { status: 'PENDING' as const };
  }

  /**
   * Transition a payment to CAPTURED and its order to PAID, atomically, exactly
   * once. The conditional updateMany makes a replayed webhook a no-op instead of
   * a double fulfilment.
   */
  async markCaptured(paymentId: string, gatewayRef: string, raw?: unknown) {
    return this.prisma.$transaction(async (tx) => {
      // ADR 010 — payment (rank 3) is claimed first here only because the order
      // id is not known until the payment row is read. The lock is then taken
      // in canonical order before either row is *modified*.
      const target = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderId: true },
      });
      await acquireLocks(tx, [
        { rank: LockRank.ORDER, id: target.orderId },
        { rank: LockRank.PAYMENT, id: paymentId },
      ]);

      const claimed = await tx.payment.updateMany({
        where: { id: paymentId, status: { in: [PaymentStatus.INITIATED, PaymentStatus.AUTHORIZED] } },
        data: {
          status: PaymentStatus.CAPTURED,
          gatewayRef,
          capturedAt: new Date(),
          rawResponse: (raw ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      // A replayed webhook lands here and is a no-op, by design.
      if (claimed.count === 0) return { alreadyCaptured: true };

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: { order: true },
      });

      assertTransition(payment.order.status, 'PAID');
      await tx.order.update({
        where: { id: payment.orderId },
        data: { status: 'PAID', paidAt: new Date(), version: { increment: 1 } },
      });

      // Fulfilment is triggered from the outbox, not inline: if this
      // transaction rolls back, no job was published; if it commits, the job
      // is guaranteed to exist.
      await this.outbox.emit(tx, {
        aggregate: 'Order',
        aggregateId: payment.orderId,
        eventType: 'order.paid',
        payload: { orderId: payment.orderId, paymentId, userId: payment.userId },
      });

      this.metrics.paymentsTotal.inc({ gateway: payment.gateway, status: 'captured' });
      this.metrics.orderValue.inc({ currency: payment.currency }, Number(payment.amountBase));

      return { alreadyCaptured: false };
    });
  }

  /**
   * Inbound gateway webhook. Stored before processing so a replay is detected
   * by the unique (source, eventId) index rather than applied twice.
   */
  async handleWebhook(source: string, rawBody: string, headers: Record<string, string>, payload: unknown) {
    const gateway = this.gateways.get(source.toUpperCase());

    if (gateway.verifyWebhookSignature && !gateway.verifyWebhookSignature(rawBody, headers)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    const parsed = gateway.parseWebhook?.(payload);
    if (!parsed) return { ignored: true };

    try {
      await this.prisma.inboundWebhook.create({
        data: {
          source, eventId: parsed.eventId, eventType: parsed.status,
          payload: payload as Prisma.InputJsonValue,
          headers: headers as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.metrics.webhooksTotal.inc({ source, result: 'duplicate' });
        return { duplicate: true };
      }
      throw err;
    }

    const payment = await this.prisma.payment.findUnique({ where: { gatewayRef: parsed.gatewayRef } });
    if (!payment) {
      this.logger.warn(`Webhook for unknown gatewayRef ${parsed.gatewayRef}`);
      return { unmatched: true };
    }

    if (parsed.status === 'CAPTURED') {
      await this.markCaptured(payment.id, parsed.gatewayRef, payload);
    } else {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { notIn: [PaymentStatus.CAPTURED, PaymentStatus.REFUNDED] } },
        data: { status: PaymentStatus.FAILED, rawResponse: payload as Prisma.InputJsonValue },
      });
    }

    await this.prisma.inboundWebhook.update({
      where: { source_eventId: { source, eventId: parsed.eventId } },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });

    this.metrics.webhooksTotal.inc({ source, result: 'processed' });
    return { processed: true };
  }

  availableMethods() {
    return this.gateways.listCodes();
  }
}
