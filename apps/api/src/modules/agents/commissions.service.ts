import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { LockRank, acquireLocks } from '../../common/locking/lock-order';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { CommissionRule, netValue, plan, targetFor } from './commission-rules';

/** Outbox events that can change an order's commission. */
export const COMMISSION_EVENTS = new Set([
  'order.paid',
  'order.processing',
  'order.completed',
  'order.partially_completed',
  'order.failed',
  'order.cancelled',
  'refund.processed',
]);

export interface SyncResult {
  action: 'none' | 'created' | 'updated' | 'clawback';
  commissionId?: string;
  status?: string;
}

const CLAWBACK_REASON_AR: Record<string, string> = {
  order_cancelled: 'أُلغي الطلب',
  order_failed: 'فشل الطلب',
  order_refunded: 'استُرجع الطلب كاملًا',
  partial_refund: 'استرجاع جزئي',
};

/**
 * Keeps an order's commission in step with the order. It never trusts the event
 * that woke it: it re-reads the order and its processed refunds under the order
 * row lock and derives the commission from those facts (commission-rules.ts).
 * So a repeated, late or out-of-order event changes nothing, and two events
 * for the same order at the same moment run one after the other.
 */
@Injectable()
export class CommissionsService {
  private readonly logger = new Logger(CommissionsService.name);

  constructor(
    private prisma: PrismaService,
    private staff: StaffNotificationsService,
  ) {}

  async syncOrder(orderId: string): Promise<SyncResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      // the same rank the payment and refund paths use for this row (ADR 010)
      await acquireLocks(tx, [{ rank: LockRank.ORDER, id: orderId }]);

      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: {
          id: true, orderNumber: true, status: true, totalBase: true, baseCurrency: true, agentId: true,
          agent: { select: { commissionType: true, commissionValue: true } },
        },
      });
      if (!order?.agentId || !order.agent) return { action: 'none' as const };

      const refunded = await tx.refund.aggregate({
        where: { orderId, status: 'PROCESSED' },
        _sum: { amountBase: true },
      });
      const net = netValue(order.totalBase, refunded._sum.amountBase);
      // Lock the commission too (after the order, as everywhere): a payout settling
      // it right now finishes first, and this then reads it as PAID instead of
      // overwriting the payout with a stale status.
      await tx.$queryRaw`SELECT "id" FROM "commissions" WHERE "orderId" = ${orderId}::uuid FOR UPDATE`;
      const existing = await tx.commission.findUnique({ where: { orderId } });
      // the rule frozen on the commission wins over today's rule
      const rule: CommissionRule = existing
        ? (existing.rule as unknown as CommissionRule)
        : { type: order.agent.commissionType, value: order.agent.commissionValue.toString() };

      const step = plan(existing, targetFor(order.status, net), rule, net);
      const now = new Date();

      switch (step.kind) {
        case 'noop':
          return { action: 'none' as const, commissionId: existing?.id, status: existing?.status };

        case 'create': {
          // ON CONFLICT DO NOTHING: should another writer ever get in first, the
          // unique orderId turns this into a no-op instead of an aborted transaction
          await tx.commission.createMany({
            data: [{
              agentId: order.agentId,
              orderId,
              basis: step.basis,
              amount: step.amount,
              currency: order.baseCurrency,
              rule: rule as unknown as Prisma.InputJsonValue,
              status: step.status,
              earnedAt: step.status === 'EARNED' ? now : null,
            }],
            skipDuplicates: true,
          });
          const row = await tx.commission.findUniqueOrThrow({ where: { orderId } });
          return { action: 'created' as const, commissionId: row.id, status: row.status };
        }

        case 'update': {
          // never over a PAID row, whatever happened meanwhile; the job is retried instead
          const { count } = await tx.commission.updateMany({
            where: { orderId, status: { not: 'PAID' } },
            data: {
              status: step.status,
              basis: step.basis,
              amount: step.amount,
              voidReason: step.voidReason,
              voidedAt: step.status === 'VOID' ? (existing?.voidedAt ?? now) : null,
              earnedAt: step.status === 'EARNED' ? (existing?.earnedAt ?? now) : step.status === 'VOID' ? existing?.earnedAt : null,
            },
          });
          if (count === 0) throw new Error(`Commission for order ${orderId} was paid meanwhile; sync again`);
          return { action: 'updated' as const, commissionId: existing?.id, status: step.status };
        }

        case 'clawback': {
          const row = await tx.commission.update({
            where: { orderId },
            data: { clawbackAmount: step.clawbackAmount, clawbackReason: step.reason, clawbackAt: now },
          });
          return {
            action: 'clawback' as const, commissionId: row.id, status: row.status,
            notice: { orderNumber: order.orderNumber, amount: step.clawbackAmount, currency: row.currency, reason: step.reason, agentId: row.agentId },
          };
        }
      }
    });

    // outside the transaction: a notice must never hold up or roll back the money path
    if ('notice' in result && result.notice) {
      const n = result.notice;
      await this.staff.notify({
        type: 'agent.clawback',
        priority: 'HIGH',
        title: 'عمولة مدفوعة تحتاج استرجاعًا',
        body: `الطلب ${n.orderNumber}: ${CLAWBACK_REASON_AR[n.reason] ?? n.reason} بعد دفع عمولة المندوب. المبلغ المستحق استرجاعه ${n.amount.toFixed(2)} ${n.currency}، وسيُخصم من الدفعة القادمة.`,
        link: `/agents/${n.agentId}`,
        dedupeKey: `agent.clawback:${result.commissionId}`,
        entityType: 'Commission',
        entityId: result.commissionId,
      });
      return { action: result.action, commissionId: result.commissionId, status: result.status };
    }
    return result;
  }

  /** Every order credited to an agent, synced again (the dashboard's "recompute"). */
  async syncAgent(agentId: string) {
    const orders = await this.prisma.order.findMany({
      where: { agentId, status: { not: 'PENDING_PAYMENT' } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const counts = { orders: orders.length, created: 0, updated: 0, clawback: 0 };
    for (const o of orders) {
      const r = await this.syncOrder(o.id);
      if (r.action !== 'none') counts[r.action]++;
    }
    return counts;
  }
}
