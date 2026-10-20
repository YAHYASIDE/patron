import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';
import { StaffNotificationsService } from './staff-notifications.service';

/** The notices about one order: closed together when the order is settled. */
const ORDER_NOTICES = ['order.new', 'order.failed', 'payment.pending'];

/**
 * Stable key for "the same server error": the message with its ids, numbers
 * and quoted values blanked, plus the route with ids blanked. Two requests that
 * fail the same way for two different orders are one problem, not two.
 */
export function errorFingerprint(message: string, path: string) {
  const blank = (s: string) =>
    s
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/(["'`]).*?\1/g, ':v')
      .replace(/\d+/g, ':n')
      .replace(/\?.*$/, '')
      .trim()
      .toLowerCase();
  return createHash('sha256').update(`${blank(message).slice(0, 300)}|${blank(path)}`).digest('hex').slice(0, 24);
}

/**
 * Raises and resolves the owner's notices from domain events, so each kind of
 * notice has one producer: the outbox relay hands every published event here
 * (orders, payments, refunds) and the few services without an outbox event
 * (transfer reported, refund requested, support message, server error) call
 * the matching method directly. Every method swallows its own errors: a notice
 * must never fail the event or request that raised it.
 */
@Injectable()
export class StaffEventsService {
  private readonly log = new Logger(StaffEventsService.name);

  constructor(
    private prisma: PrismaService,
    private staff: StaffNotificationsService,
  ) {}

  /** Called by the outbox relay for every event it publishes. */
  async onOutboxEvent(eventType: string, payload: { orderId?: string; paymentId?: string; refundId?: string }) {
    try {
      const { orderId, paymentId, refundId } = payload;
      switch (eventType) {
        case 'order.paid':
          if (paymentId) await this.staff.resolve(`payment.pending:${paymentId}`);
          if (orderId) await this.orderToDeliver(orderId);
          break;
        case 'order.failed':
        case 'order.partially_completed':
          if (orderId) await this.orderFailed(orderId);
          break;
        case 'order.completed':
        case 'order.cancelled':
        case 'order.refunded':
          if (orderId) await this.staff.resolveFor('Order', orderId, ORDER_NOTICES);
          break;
        case 'refund.processed':
          if (refundId) await this.staff.resolve(`refund.pending:${refundId}`);
          if (orderId) await this.closeIfRefunded(orderId);
          break;
        default:
          break;
      }
    } catch (e) {
      this.log.warn(`staff notice for ${eventType} skipped: ${e instanceof Error ? e.message : e}`);
    }
  }

  private order(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, status: true, total: true, currency: true },
    });
  }

  /** A paid order waiting for its delivery. A replayed event for an order already settled raises nothing. */
  private async orderToDeliver(orderId: string) {
    const order = await this.order(orderId);
    if (!order || !['PAID', 'PROCESSING'].includes(order.status)) return;
    await this.staff.notify({
      type: 'order.new',
      priority: 'NORMAL',
      title: `طلب مدفوع ${order.orderNumber}`,
      body: `تم دفع ${order.total.toString()} ${order.currency}. تابع تسليم الطلب حتى يكتمل.`,
      link: `/orders/${order.id}`,
      dedupeKey: `order.new:${order.id}`,
      entityType: 'Order',
      entityId: order.id,
    });
  }

  private async orderFailed(orderId: string) {
    const order = await this.order(orderId);
    if (!order || !['FAILED', 'PARTIALLY_COMPLETED'].includes(order.status)) return;
    const partial = order.status === 'PARTIALLY_COMPLETED';
    await this.staff.notify({
      type: 'order.failed',
      priority: 'URGENT',
      title: partial ? `جزء من الطلب ${order.orderNumber} لم يُسلَّم` : `فشل تسليم الطلب ${order.orderNumber}`,
      body: 'الزبون دفع ولم يستلم كل ما طلبه. أعد المحاولة أو سلّم يدوياً أو استرجع المبلغ.',
      link: `/orders/${order.id}`,
      dedupeKey: `order.failed:${order.id}`,
      entityType: 'Order',
      entityId: order.id,
    });
    // the failure notice replaces "to deliver": one notice per problem
    await this.staff.resolve(`order.new:${order.id}`);
  }

  private async closeIfRefunded(orderId: string) {
    const order = await this.order(orderId);
    if (order?.status === 'REFUNDED') await this.staff.resolveFor('Order', orderId, ORDER_NOTICES);
  }

  // ── producers without an outbox event ──

  /** The customer reported a manual transfer: someone must check the bank app. */
  async transferReported(p: { paymentId: string; orderId: string; orderNumber: string; amount: string; currency: string; method?: string }) {
    try {
      await this.staff.notify({
        type: 'payment.pending',
        priority: 'HIGH',
        title: `تحويل بانتظار المراجعة — ${p.orderNumber}`,
        body: `أبلغ الزبون عن تحويل ${p.amount} ${p.currency}${p.method ? ` عبر ${p.method}` : ''}. تحقّق من وصول المبلغ ثم وافق أو ارفض.`,
        link: `/orders/${p.orderId}`,
        dedupeKey: `payment.pending:${p.paymentId}`,
        entityType: 'Order',
        entityId: p.orderId,
        data: { paymentId: p.paymentId },
      });
    } catch (e) {
      this.log.warn(`payment.pending not raised: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Approved transfers close through order.paid; a rejected one closes here. */
  async transferReviewed(paymentId: string) {
    try {
      await this.staff.resolve(`payment.pending:${paymentId}`);
    } catch (e) {
      this.log.warn(`payment.pending not resolved: ${e instanceof Error ? e.message : e}`);
    }
  }

  async refundRequested(p: { refundId: string; orderId: string; orderNumber: string; amount: string; currency: string }) {
    try {
      await this.staff.notify({
        type: 'refund.pending',
        priority: 'HIGH',
        title: `استرجاع بانتظار التنفيذ — ${p.orderNumber}`,
        body: `طُلب استرجاع ${p.amount} ${p.currency}. أرسل المبلغ للزبون ثم سجّل الاسترجاع.`,
        link: `/orders/${p.orderId}`,
        dedupeKey: `refund.pending:${p.refundId}`,
        entityType: 'Refund',
        entityId: p.refundId,
        data: { orderId: p.orderId },
      });
    } catch (e) {
      this.log.warn(`refund.pending not raised: ${e instanceof Error ? e.message : e}`);
    }
  }

  async refundClosed(refundId: string) {
    try {
      await this.staff.resolve(`refund.pending:${refundId}`);
    } catch (e) {
      this.log.warn(`refund.pending not resolved: ${e instanceof Error ? e.message : e}`);
    }
  }

  async supportMessage(p: { ticketId: string; subject: string; orderNumber?: string | null }) {
    try {
      await this.staff.notify({
        type: 'support.message',
        priority: 'NORMAL',
        title: p.orderNumber ? `طلب مساعدة عن الطلب ${p.orderNumber}` : 'طلب مساعدة جديد',
        body: p.subject,
        link: '/support',
        dedupeKey: `support.message:${p.ticketId}`,
        entityType: 'SupportTicket',
        entityId: p.ticketId,
      });
    } catch (e) {
      this.log.warn(`support.message not raised: ${e instanceof Error ? e.message : e}`);
    }
  }

  async supportHandled(ticketId: string) {
    try {
      await this.staff.resolve(`support.message:${ticketId}`);
    } catch (e) {
      this.log.warn(`support.message not resolved: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * One live notice per kind of server error, however often it happens: while
   * it is open, a repeat only counts up (it does not ring again); once resolved,
   * the next occurrence reopens it. A payment taken twice is money: URGENT.
   */
  async serverError(r: { message: string; method: string; path: string; status: number }) {
    // a health probe answering 503 (database waking up, disk threshold) is the platform's
    // concern, not something the owner can act on: it would only keep a notice counting up
    if (/\/health(\/|$)/.test(r.path)) return;
    try {
      const money = /^Duplicate payment/i.test(r.message);
      // each duplicate payment is its own refund to make: never folded together
      const fingerprint = money
        ? createHash('sha256').update(r.message).digest('hex').slice(0, 24)
        : errorFingerprint(r.message, r.path);
      const dedupeKey = `system.error:${fingerprint}`;
      const open = await this.prisma.staffNotification.findFirst({
        where: { dedupeKey, resolvedAt: null },
        select: { id: true, data: true },
      });
      if (open) {
        const seen = typeof open.data === 'object' && open.data && 'count' in open.data ? Number(open.data.count) || 1 : 1;
        await this.prisma.staffNotification.update({
          where: { id: open.id },
          data: { data: { count: seen + 1, lastAt: new Date().toISOString() } },
        });
        return;
      }
      await this.staff.notify({
        type: 'system.error',
        priority: money ? 'URGENT' : 'NORMAL',
        title: money ? 'دفعة مكررة: أعد المبلغ للزبون' : 'خطأ في الخادم',
        body: `${r.method} ${r.path.slice(0, 120)} — ${r.message.slice(0, 200)}`,
        link: money ? r.path.slice(0, 200) : '/errors',
        dedupeKey,
        entityType: 'ServerError',
        entityId: fingerprint,
        data: { count: 1, lastAt: new Date().toISOString() },
      });
    } catch (e) {
      this.log.warn(`system.error not raised: ${e instanceof Error ? e.message : e}`);
    }
  }
}
