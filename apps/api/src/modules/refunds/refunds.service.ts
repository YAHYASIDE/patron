import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RefundStatus, WalletTxnType } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { WalletService } from '../wallet/wallet.service';
import { GatewayRegistry } from '../payments/gateways/gateway.registry';
import { D } from '../../common/money/money';
import { LockRank, acquireLocks } from '../../common/locking/lock-order';
import { toAuditJson } from '../../common/audit/audit.service';

@Injectable()
export class RefundsService {
  constructor(
    private prisma: PrismaService,
    private wallet: WalletService,
    private gateways: GatewayRegistry,
    private outbox: OutboxService,
  ) {}

  /**
   * Refunds are requested, then processed. Splitting the two keeps an approval
   * step available and means a failed gateway call leaves an auditable
   * REQUESTED row rather than vanishing.
   */
  async request(
    orderId: string,
    amount: number | undefined,
    reason: string,
    requestedById: string,
    toWallet = false,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { where: { status: 'CAPTURED' } }, refunds: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const payment = order.payments[0];
    if (!payment) throw new BadRequestException('This order has no captured payment');

    const alreadyRefunded = order.refunds
      .filter((r) => r.status === RefundStatus.PROCESSED)
      .reduce((acc, r) => acc.plus(r.amount), new Prisma.Decimal(0));

    const requested = amount !== undefined ? D(amount) : order.total.minus(alreadyRefunded);
    if (requested.lte(0)) throw new BadRequestException('Refund amount must be positive');
    if (alreadyRefunded.plus(requested).gt(order.total)) {
      throw new BadRequestException(
        `Refund exceeds order total. Already refunded: ${alreadyRefunded} ${order.currency}`,
      );
    }

    return this.prisma.refund.create({
      data: {
        orderId,
        paymentId: payment.id,
        amount: requested,
        currency: order.currency,
        // Reuse the order's frozen rate: refunding at today's rate would hand
        // the customer an FX gain or loss they never agreed to.
        fxRate: order.fxRate,
        amountBase: requested.div(order.fxRate).toDecimalPlaces(4),
        reason,
        toWallet,
        requestedById,
      },
    });
  }

  async process(refundId: string, processedById: string) {
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { order: true, payment: true },
    });
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status === RefundStatus.PROCESSED) return refund;
    if (refund.status === RefundStatus.REJECTED) throw new BadRequestException('This refund was rejected');

    let gatewayRef: string | undefined;

    // Wallet refunds settle internally; card refunds must reach the gateway
    // first, so a gateway failure never credits a balance we did not recover.
    if (!refund.toWallet && refund.payment?.gatewayRef) {
      const gateway = this.gateways.get(refund.payment.gateway);
      const result = await gateway.refund({
        gatewayRef: refund.payment.gatewayRef,
        amount: refund.amount,
        currency: refund.currency,
        reason: refund.reason,
      });
      gatewayRef = result.gatewayRef;
    }

    return this.prisma.$transaction(async (tx) => {
      // Rank 1: acquired before any order/payment/refund row is touched.
      await this.wallet.lockWallet(refund.order.userId, refund.currency, tx);

      /**
       * ADR 010 — global lock order: wallet → order → payment → refund.
       *
       * The natural reading order here is the exact reverse (refund first),
       * which is what could deadlock against a concurrent wallet payment for
       * the same customer. The wallet lock is taken unconditionally, even for
       * card refunds that will never touch the balance, because a conditional
       * lock is a lock ordering that depends on data — and that is the same
       * bug wearing a disguise.
       */
      const resources: Array<{ rank: LockRank; id: string }> = [
        { rank: LockRank.ORDER, id: refund.orderId },
        { rank: LockRank.REFUND, id: refund.id },
      ];
      if (refund.paymentId) resources.push({ rank: LockRank.PAYMENT, id: refund.paymentId });

      await acquireLocks(tx, resources);

      const claimed = await tx.refund.updateMany({
        where: { id: refundId, status: { in: [RefundStatus.REQUESTED, RefundStatus.APPROVED] } },
        data: { status: RefundStatus.PROCESSED, processedById, processedAt: new Date(), gatewayRef },
      });
      if (claimed.count === 0) throw new BadRequestException('This refund is already being processed');

      if (refund.toWallet) {
        await this.wallet.credit(
          {
            userId: refund.order.userId,
            currency: refund.currency,
            amount: refund.amount,
            type: WalletTxnType.REFUND,
            referenceType: 'refund',
            referenceId: refund.id,
            description: `Refund for order ${refund.order.orderNumber}`,
            createdById: processedById,
          },
          tx,
        );
      }

      if (refund.paymentId) {
        await tx.payment.update({
          where: { id: refund.paymentId },
          data: {
            refundedAmount: { increment: refund.amount },
            status: refund.amount.gte(refund.order.total) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
            version: { increment: 1 },
          },
        });
      }

      const totalRefunded = await tx.refund.aggregate({
        where: { orderId: refund.orderId, status: RefundStatus.PROCESSED },
        _sum: { amount: true },
      });
      if ((totalRefunded._sum.amount ?? new Prisma.Decimal(0)).gte(refund.order.total)) {
        await tx.order.update({
          where: { id: refund.orderId },
          data: { status: 'REFUNDED', version: { increment: 1 } },
        });
        await tx.orderItem.updateMany({
          where: { orderId: refund.orderId, status: { in: ['DELIVERED', 'FAILED'] } },
          data: { status: 'REFUNDED' },
        });
      }

      await this.outbox.emit(tx, {
        aggregate: 'Refund',
        aggregateId: refund.id,
        eventType: 'refund.processed',
        payload: { refundId: refund.id, orderId: refund.orderId, userId: refund.order.userId },
      });
      await tx.auditLog.create({
        data: {
          userId: processedById, action: 'payments.refund', entityType: 'Refund', entityId: refund.id,
          after: toAuditJson({ amount: refund.amount.toString(), currency: refund.currency }),
        },
      });

      return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  reject(refundId: string, processedById: string, reason: string) {
    return this.prisma.refund.update({
      where: { id: refundId },
      data: {
        status: RefundStatus.REJECTED,
        processedById,
        processedAt: new Date(),
        reason: reason.slice(0, 500),
      },
    });
  }

  findAll(status?: RefundStatus) {
    return this.prisma.refund.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { order: { select: { orderNumber: true, userId: true } } },
    });
  }
}
