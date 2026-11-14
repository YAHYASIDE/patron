import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaymentGateway as GatewayEnum, PaymentStatus, Prisma, WalletTxnType } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { GatewayRegistry } from './gateways/gateway.registry';
import { assertTransition, canTransition } from '../orders/order-state.machine';
import { MetricsService } from '../../common/metrics/metrics.service';
import { LockRank, acquireLocks } from '../../common/locking/lock-order';
import { AuditService } from '../../common/audit/audit.service';
import {
  ManualAccount, ManualTransferGateway, MANUAL_ACCOUNTS_KEY, MANUAL_NOTE_KEY, isUsable,
} from './gateways/manual.gateway';
import { UploadsService, IncomingFile } from '../uploads/uploads.service';
import { ManualAccountsDto, SubmitTransferDto } from './dto/payment.dto';
import { writeInAppNotification } from '../notifications/in-app';
import { WalletService } from '../wallet/wallet.service';
import { reportServerError } from '../../common/filters/server-error-sink';

/** What the customer reported for a manual transfer, kept on the payment. */
interface TransferReport {
  accountId: string;
  method: string;
  reference?: string;
  payerName?: string;
  /** The number or account the money came from. */
  payerPhone: string;
  hasProof: boolean;
  submittedAt: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private prisma: PrismaService,
    private gateways: GatewayRegistry,
    private outbox: OutboxService,
    private metrics: MetricsService,
    private audit: AuditService,
    private manual: ManualTransferGateway,
    private uploads: UploadsService,
    private wallet: WalletService,
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

    if (gatewayCode === 'WALLET') return this.payFromWallet(orderId, userId);

    // Reuse an in-flight attempt rather than creating a second charge.
    const inFlight = await this.prisma.payment.findFirst({
      where: { orderId, status: { in: ['INITIATED', 'AUTHORIZED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight && inFlight.gateway === gatewayCode) {
      const inFlightGateway = this.gateways.get(gatewayCode);
      const verified = await inFlightGateway.verify(inFlight.gatewayRef ?? '');
      if (verified.status === 'PENDING') {
        // a card page still open is reused; an expired one falls through to a new attempt
        const redirectUrl = inFlight.gatewayRef ? await inFlightGateway.resumeUrl?.(inFlight.gatewayRef) : undefined;
        if (!inFlightGateway.resumeUrl || redirectUrl) {
          return { paymentId: inFlight.id, status: inFlight.status, gatewayRef: inFlight.gatewayRef, redirectUrl };
        }
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

    // A manual transfer stays INITIATED until the customer submits a reference;
    // only then is there something for staff to review.
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: gateway.awaitsCustomerProof ? PaymentStatus.INITIATED : PaymentStatus.AUTHORIZED,
        gatewayRef: result.gatewayRef,
        version: { increment: 1 },
      },
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
   * Pay an order from the wallet: the order check, the debit and the capture
   * are one transaction under the order's row lock. Two taps, two tabs or a
   * retry after a dropped connection each carry a new Idempotency-Key, so the
   * key cannot stop them; the lock does — the second request waits, then finds
   * the order already paid and charges nothing. Locks follow ADR 010: wallet
   * first, then order, then payment.
   */
  private payFromWallet(orderId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const head = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { currency: true } });
      await this.wallet.lockWallet(userId, head.currency, tx);
      await acquireLocks(tx, [{ rank: LockRank.ORDER, id: orderId }]);

      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status !== 'PENDING_PAYMENT') throw new BadRequestException('This order is not awaiting payment');

      const payment = await tx.payment.create({
        data: {
          orderId,
          userId,
          gateway: 'WALLET',
          amount: order.total,
          currency: order.currency,
          baseCurrency: order.baseCurrency,
          fxRate: order.fxRate,
          amountBase: order.totalBase,
          fxRateId: order.fxRateId,
          status: PaymentStatus.INITIATED,
        },
      });
      // an insufficient balance throws here and rolls the payment row back with it
      await this.wallet.debit(
        {
          userId,
          currency: order.currency,
          amount: order.total,
          type: WalletTxnType.ORDER_PAYMENT,
          referenceType: 'order',
          referenceId: orderId,
          description: `Order ${order.orderNumber}`,
        },
        tx,
      );
      const gatewayRef = `wallet_${payment.id}`;
      await this.capture(tx, payment.id, gatewayRef);
      return { paymentId: payment.id, status: 'CAPTURED' as const, gatewayRef };
    });
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
  markCaptured(paymentId: string, gatewayRef: string, raw?: unknown) {
    return this.prisma.$transaction((tx) => this.capture(tx, paymentId, gatewayRef, raw));
  }

  private async capture(tx: Prisma.TransactionClient, paymentId: string, gatewayRef: string, raw?: unknown) {
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

    // A second payment for an order that is already paid (a card page paid
    // in another tab, a transfer approved twice) must not pay it again: the
    // payment is set aside and the owner is told, so the money goes back.
    if (payment.order.status !== 'PENDING_PAYMENT' && canTransition(payment.order.status, 'REFUNDED')) {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.FAILED, failureCode: 'duplicate_payment', failureReason: 'The order was already paid', version: { increment: 1 } },
      });
      reportServerError({
        message: `Duplicate payment ${paymentId} for order ${payment.order.orderNumber}: refund it to the customer`,
        method: 'CAPTURE',
        path: `/orders/${payment.orderId}`,
        status: 409,
        correlationId: `payment:${paymentId}`,
      });
      return { alreadyCaptured: true, duplicate: true };
    }

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

  /** Methods the checkout may offer now (Stripe needs keys, manual transfer needs accounts). */
  availableMethods() {
    return this.gateways.listEnabledCodes();
  }

  // ───────────────────────── manual transfer ─────────────────────────

  /**
   * Where to send a manual transfer. Customers only see methods that are
   * switched on and have a receiving number; the dashboard sees them all.
   */
  async manualInstructions(all = false): Promise<{ accounts: ManualAccount[]; note: string | null }> {
    const note = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_NOTE_KEY } });
    const accounts = await this.manual.accounts();
    return {
      accounts: all ? accounts : accounts.filter(isUsable),
      note: typeof note?.value === 'string' ? note.value : null,
    };
  }

  /** Owner sets the transfer accounts customers see at checkout. */
  async setManualInstructions(dto: ManualAccountsDto, actorId: string) {
    const accounts: ManualAccount[] = dto.accounts.map((a) => ({
      id: a.id || randomUUID(),
      method: a.method.trim(),
      countries: [...new Set((a.countries ?? (a.country ? [a.country] : [])).map((c) => c.toUpperCase()))],
      accountName: a.accountName?.trim() ?? '',
      accountNumber: a.accountNumber?.trim() ?? '',
      kind: a.kind ?? 'mobile',
      ...(a.logo && { logo: a.logo }),
      enabled: a.enabled ?? true,
      ...(a.instructions?.trim() && { instructions: a.instructions.trim() }),
    }));
    const missing = accounts.find((a) => a.enabled && a.accountNumber.length < 2);
    if (missing) {
      throw new BadRequestException({
        message: `${missing.method}: add the number customers pay to, or switch it off`,
        error: 'ACCOUNT_NUMBER_REQUIRED',
      });
    }
    const value = JSON.parse(JSON.stringify(accounts)) as Prisma.InputJsonValue;
    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: MANUAL_ACCOUNTS_KEY },
        update: { value },
        create: { key: MANUAL_ACCOUNTS_KEY, value, group: 'payments', isPublic: true, description: 'Manual transfer accounts shown at checkout' },
      });
      await tx.systemSetting.upsert({
        where: { key: MANUAL_NOTE_KEY },
        update: { value: dto.note?.trim() ?? '' },
        create: { key: MANUAL_NOTE_KEY, value: dto.note?.trim() ?? '', group: 'payments', isPublic: true, description: 'Note shown with the manual transfer accounts' },
      });
      await this.audit.record(tx, { actorId, action: 'payments.manual_accounts.update', entityType: 'SystemSetting', entityId: MANUAL_ACCOUNTS_KEY, after: accounts });
    });
    return this.manualInstructions();
  }

  /**
   * The customer reports the transfer they made. Allowed again until staff
   * review it (to correct a typo); the amount is the order's, never the client's.
   */
  async submitTransfer(paymentId: string, userId: string, dto: SubmitTransferDto) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new ForbiddenException('This payment belongs to another account');
    if (payment.gateway !== 'MANUAL') throw new BadRequestException('Only a manual transfer takes a transaction reference');
    if (!['INITIATED', 'AUTHORIZED'].includes(payment.status)) {
      throw new BadRequestException('This payment has already been reviewed');
    }
    if (payment.order.status !== 'PENDING_PAYMENT') throw new BadRequestException('This order is not awaiting payment');

    const account = (await this.manual.accounts()).find((a) => a.id === dto.accountId && isUsable(a));
    if (!account) throw new BadRequestException('Unknown transfer account');
    // the owner checks the receipt against their app before approving
    if (!(await this.uploads.hasProof(paymentId))) {
      throw new BadRequestException({ message: 'Attach a screenshot of the transfer', error: 'PROOF_REQUIRED' });
    }

    const transfer: TransferReport = {
      accountId: account.id,
      method: account.method,
      reference: dto.reference?.trim() || undefined,
      payerName: dto.payerName?.trim() || undefined,
      payerPhone: dto.payerPhone.trim(),
      hasProof: true,
      submittedAt: new Date().toISOString(),
    };
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: PaymentStatus.AUTHORIZED,
        rawResponse: JSON.parse(JSON.stringify({ transfer })) as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    return { paymentId, status: 'AUTHORIZED' as const };
  }

  /** Staff queue: transfers customers reported, oldest first. */
  /** The customer attaches a screenshot of their transfer before reporting it. */
  async attachProof(paymentId: string, userId: string, file: IncomingFile | undefined) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { userId: true, gateway: true, status: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.userId !== userId) throw new ForbiddenException('This payment belongs to another account');
    if (payment.gateway !== 'MANUAL') throw new BadRequestException('Only a manual transfer takes a receipt');
    if (!['INITIATED', 'AUTHORIZED'].includes(payment.status)) {
      throw new BadRequestException('This payment has already been reviewed');
    }
    return this.uploads.saveProof(paymentId, file, userId);
  }

  /** Staff open the receipt while checking a transfer. */
  proof(paymentId: string) {
    return this.uploads.getProof(paymentId);
  }

  listManualPending() {
    return this.prisma.payment.findMany({
      where: { gateway: 'MANUAL', status: PaymentStatus.AUTHORIZED },
      orderBy: { updatedAt: 'asc' },
      select: {
        id: true, amount: true, currency: true, status: true, rawResponse: true, createdAt: true, updatedAt: true,
        order: { select: { id: true, orderNumber: true, status: true, user: { select: { email: true, fullName: true, phone: true } } } },
      },
    });
  }

  /** Staff confirmed the money arrived: the payment captures and the order becomes PAID. */
  async approveManual(paymentId: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.gateway !== 'MANUAL') throw new NotFoundException('Manual payment not found');
    if (payment.status === PaymentStatus.CAPTURED) return { status: 'CAPTURED' as const };
    if (payment.status !== PaymentStatus.AUTHORIZED) {
      throw new BadRequestException('Approve a transfer only after the customer has submitted its reference');
    }

    const raw = { ...((payment.rawResponse as Record<string, unknown> | null) ?? {}), review: { decision: 'approved', by: actorId, at: new Date().toISOString() } };
    await this.markCaptured(payment.id, payment.gatewayRef ?? `manual_${payment.id}`, raw);
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, { actorId, action: 'payments.manual.approve', entityType: 'Payment', entityId: payment.id }),
    );
    return { status: 'CAPTURED' as const };
  }

  /** Staff could not find the transfer: the payment fails and the customer can pay again. */
  async rejectManual(paymentId: string, reason: string, actorId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.gateway !== 'MANUAL') throw new NotFoundException('Manual payment not found');
    const raw = { ...((payment.rawResponse as Record<string, unknown> | null) ?? {}), review: { decision: 'rejected', by: actorId, at: new Date().toISOString(), reason } };

    const { count } = await this.prisma.payment.updateMany({
      where: { id: paymentId, status: { in: [PaymentStatus.INITIATED, PaymentStatus.AUTHORIZED] } },
      data: {
        status: PaymentStatus.FAILED,
        failureCode: 'rejected_by_staff',
        failureReason: reason,
        rawResponse: JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });
    if (count === 0) throw new BadRequestException('This payment has already been reviewed');
    const order = await this.prisma.order.findUnique({ where: { id: payment.orderId }, select: { orderNumber: true } });
    const number = order?.orderNumber ?? '';
    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, { actorId, action: 'payments.manual.reject', entityType: 'Payment', entityId: paymentId, after: { reason } });
      // The customer learns why, and that the order page lets them pay again.
      await writeInAppNotification(tx, {
        userId: payment.userId,
        type: 'payment.rejected',
        orderId: payment.orderId,
        link: `/orders/${payment.orderId}`,
        extra: { reason, paymentId },
        ar: { title: 'لم نتمكّن من تأكيد تحويلك', body: `راجعنا تحويل الطلب ${number} ولم نؤكّده: ${reason}. يمكنك الدفع من جديد من صفحة الطلب.` },
        en: { title: 'We could not confirm your transfer', body: `We checked the transfer for order ${number} and could not confirm it: ${reason}. You can pay again from the order page.` },
        fr: { title: 'Virement non confirmé', body: `Nous avons vérifié le virement de la commande ${number} sans pouvoir le confirmer : ${reason}. Vous pouvez payer à nouveau depuis la page de la commande.` },
      });
    });
    return { status: 'FAILED' as const };
  }
}
