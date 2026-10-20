import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { Prisma, UsdtDelivery, UsdtNetwork, UsdtOrder, UsdtOrderStatus } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TxClient } from '../../common/locking/lock-order';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { IncomingFile, MAX_UPLOAD_BYTES, sniffImage } from '../uploads/uploads.service';
import { MANUAL_ACCOUNTS_KEY, ManualAccount, isUsable, normalizeAccount } from '../payments/gateways/manual.gateway';
import { UsdtConfigService } from './usdt-config.service';
import { CreateUsdtOrderDto, SubmitUsdtPaymentDto, UsdtOrdersQueryDto, UsdtQuoteDto } from './dto/usdt.dto';
import { UsdtConfig, canMove, computeQuote } from './usdt-rules';
import { validateAddress, validateBinanceId, validateTxid } from './usdt-address';

/** Kind of the `uploads` row that holds a customer's receipt for a USDT order. */
export const USDT_PROOF_KIND = 'usdt_proof';

/** A customer may keep this many unpaid orders open at once. */
export const MAX_OPEN_ORDERS = 3;

const reviewKey = (id: string) => `usdt.review:${id}`;
const sendKey = (id: string) => `usdt.send:${id}`;

const bad = (error: string, message: string, extra: Record<string, unknown> = {}) =>
  new BadRequestException({ message, error, ...extra });
const notFound = () => new NotFoundException({ message: 'USDT order not found', error: 'USDT_ORDER_NOT_FOUND' });
const wrongStatus = (status: UsdtOrderStatus) =>
  new ConflictException({ message: `This order is ${status} and cannot do that`, error: 'USDT_INVALID_STATUS', status });

interface Move {
  to: UsdtOrderStatus;
  action: string;
  actorId: string | null;
  note?: string;
  data?: Record<string, unknown>;
  /** Extra columns written with the status. */
  set?: Prisma.UsdtOrderUncheckedUpdateManyInput;
  /** Audit action; defaults to `usdt.<action>`. */
  audit?: string;
}

/**
 * Customers buying USDT. Nothing here moves crypto: staff check the payment,
 * approve, send by hand from their own wallet and record the TXID. Every
 * change locks the order row, checks the status machine, and writes a
 * UsdtOrderEvent and an AuditLog row in the same transaction.
 */
@Injectable()
export class UsdtService {
  private readonly log = new Logger(UsdtService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: UsdtConfigService,
    private staff: StaffNotificationsService,
  ) {}

  // ───────────────────────── quotes ─────────────────────────

  private async requireVerified(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { phoneVerifiedAt: true } });
    if (!user) throw new ForbiddenException({ message: 'Account not found', error: 'ACCOUNT_NOT_FOUND' });
    // same rule as checkout: the owner knows who is buying
    if (!user.phoneVerifiedAt) {
      throw new ForbiddenException({ message: 'Verify your WhatsApp number before ordering', error: 'PHONE_NOT_VERIFIED' });
    }
  }

  /** Prices a request with the owner's current terms. Throws a coded 400 for anything outside them. */
  private async price(config: UsdtConfig, dto: UsdtQuoteDto) {
    const amount = new Prisma.Decimal(dto.amountUsdt);
    const min = new Prisma.Decimal(config.minUsdt);
    const max = new Prisma.Decimal(config.maxUsdt);
    if (amount.lt(min) || amount.gt(max)) {
      throw bad('USDT_AMOUNT_OUT_OF_RANGE', `Choose between ${config.minUsdt} and ${config.maxUsdt} USDT`, { min: config.minUsdt, max: config.maxUsdt });
    }
    const rateText = config.rates[dto.currency];
    const currency = rateText
      ? await this.prisma.currency.findFirst({ where: { code: dto.currency, isActive: true }, select: { decimals: true } })
      : null;
    if (!rateText || !currency) throw bad('USDT_CURRENCY_UNSUPPORTED', `USDT is not sold in ${dto.currency}`);

    let network: UsdtNetwork | null = null;
    if (dto.delivery === UsdtDelivery.BINANCE) {
      if (!config.binanceEnabled) throw bad('USDT_BINANCE_DISABLED', 'Binance transfer is not offered at the moment');
    } else {
      if (!dto.network) throw bad('USDT_NETWORK_REQUIRED', 'Choose the network (TRC20, BEP20 or ERC20)');
      if (!config.networks[dto.network]) throw bad('USDT_NETWORK_DISABLED', `${dto.network} is not offered at the moment`);
      network = dto.network;
    }

    const rate = new Prisma.Decimal(rateText);
    const feePercent = new Prisma.Decimal(config.feePercent);
    const feeFixedUsdt = new Prisma.Decimal(config.feeFixedUsdt);
    const amounts = computeQuote({ amountUsdt: amount, rate, feePercent, feeFixedUsdt, decimals: currency.decimals });
    return { amount, rate, network, feePercent, feeFixedUsdt, ...amounts };
  }

  async quote(userId: string, dto: UsdtQuoteDto) {
    const config = await this.config.requireEnabled();
    await this.requireVerified(userId);
    const p = await this.price(config, dto);
    return {
      amountUsdt: p.amount.toFixed(2),
      currency: dto.currency,
      delivery: dto.delivery,
      network: p.network,
      rate: p.rate.toString(),
      feePercent: p.feePercent.toString(),
      feeFixedUsdt: p.feeFixedUsdt.toString(),
      subtotal: p.subtotal.toString(),
      fee: p.fee.toString(),
      total: p.total.toString(),
      expiryMinutes: config.expiryMinutes,
    };
  }

  // ───────────────────────── customer orders ─────────────────────────

  /**
   * One Idempotency-Key, one order: a retried tap returns the order the first
   * request made instead of a second one. The key is stored per customer.
   */
  async create(userId: string, idempotencyKey: string | undefined, dto: CreateUsdtOrderDto) {
    const key = (idempotencyKey ?? '').trim();
    if (key.length < 8 || key.length > 200) {
      throw bad('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8–200 characters)');
    }
    const scopedKey = `${userId}:${key}`;
    const existing = await this.prisma.usdtOrder.findUnique({ where: { idempotencyKey: scopedKey } });
    if (existing) return this.forCustomer(existing.id, userId);

    const config = await this.config.requireEnabled();
    await this.requireVerified(userId);
    const p = await this.price(config, dto);

    let address: string | null = null;
    let binanceId: string | null = null;
    if (dto.delivery === UsdtDelivery.BINANCE) {
      const check = validateBinanceId(dto.binanceId);
      if (!check.ok) throw bad(check.code, check.message);
      binanceId = check.value;
    } else {
      const check = validateAddress(p.network!, dto.address);
      if (!check.ok) throw bad(check.code, check.message, { network: p.network });
      address = check.value;
    }

    // the customer confirmed a total: if the owner changed the terms since, show them the new one first
    if (dto.expectedTotal !== undefined && !new Prisma.Decimal(dto.expectedTotal).eq(p.total)) {
      throw new ConflictException({
        message: 'The price changed. Check the new total and confirm again.',
        error: 'USDT_QUOTE_CHANGED',
        total: p.total.toString(),
        rate: p.rate.toString(),
        fee: p.fee.toString(),
        subtotal: p.subtotal.toString(),
      });
    }

    const open = await this.prisma.usdtOrder.count({ where: { userId, status: { in: ['NEW', 'AWAITING_PAYMENT'] } } });
    if (open >= MAX_OPEN_ORDERS) {
      throw bad('USDT_TOO_MANY_OPEN', 'Pay or cancel your open USDT orders before starting another');
    }

    const expiresAt = new Date(Date.now() + config.expiryMinutes * 60_000);
    for (let attempt = 0; ; attempt++) {
      try {
        const order = await this.prisma.$transaction(async (tx) => {
          const row = await tx.usdtOrder.create({
            data: {
              number: this.newNumber(),
              userId,
              status: UsdtOrderStatus.AWAITING_PAYMENT,
              amountUsdt: p.amount,
              delivery: dto.delivery,
              network: p.network,
              address,
              binanceId,
              rate: p.rate,
              currency: dto.currency,
              subtotal: p.subtotal,
              fee: p.fee,
              total: p.total,
              idempotencyKey: scopedKey,
              expiresAt,
            },
          });
          const terms = { feePercent: config.feePercent, feeFixedUsdt: config.feeFixedUsdt };
          await this.event(tx, row.id, { action: 'created', from: UsdtOrderStatus.NEW, to: row.status, actorId: userId, data: terms });
          await this.audit.record(tx, {
            actorId: userId, action: 'usdt.order.create', entityType: 'UsdtOrder', entityId: row.id,
            after: { number: row.number, amountUsdt: row.amountUsdt, total: row.total, currency: row.currency, delivery: row.delivery, network: row.network },
          });
          return row;
        });
        return this.forCustomer(order.id, userId);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
          // a concurrent request with the same key won the race: answer with its order
          if (target.includes('idempotencyKey')) {
            const won = await this.prisma.usdtOrder.findUnique({ where: { idempotencyKey: scopedKey } });
            if (won) return this.forCustomer(won.id, userId);
          }
          if (target.includes('number') && attempt < 3) continue;
        }
        throw e;
      }
    }
  }

  /** USDT-20261020-482913: the day plus six random digits (retried on the rare clash). */
  private newNumber() {
    const d = new Date();
    const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `USDT-${day}-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`;
  }

  async listMine(userId: string) {
    const rows = await this.prisma.usdtOrder.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((o) => this.customerView(o));
  }

  async forCustomer(id: string, userId: string) {
    const order = await this.prisma.usdtOrder.findFirst({
      where: { id, userId },
      include: { events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!order) throw notFound();
    return {
      ...this.customerView(order),
      events: order.events.map((e) => ({
        action: e.action,
        status: e.toStatus,
        at: e.createdAt,
        // the customer sees why an order was rejected, nothing else staff wrote
        ...(e.action === 'rejected' && e.note ? { note: e.note } : {}),
      })),
    };
  }

  /** What a customer may see: no idempotency key, no reviewer, no upload id. */
  private customerView(o: UsdtOrder) {
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      amountUsdt: o.amountUsdt.toFixed(2),
      delivery: o.delivery,
      network: o.network,
      address: o.address,
      binanceId: o.binanceId,
      rate: o.rate.toString(),
      currency: o.currency,
      subtotal: o.subtotal.toString(),
      fee: o.fee.toString(),
      total: o.total.toString(),
      paymentMethod: o.paymentMethod,
      payerPhone: o.payerPhone,
      paymentRef: o.paymentRef,
      hasProof: !!o.proofUploadId,
      txid: o.txid,
      rejectReason: o.rejectReason,
      expiresAt: o.expiresAt,
      paidAt: o.paidAt,
      approvedAt: o.approvedAt,
      completedAt: o.completedAt,
      createdAt: o.createdAt,
    };
  }

  /** The receipt for the transfer; a new picture replaces the previous one. */
  async attachProof(userId: string, id: string, file: IncomingFile | undefined) {
    if (!file?.buffer?.length) throw bad('USDT_PROOF_REQUIRED', 'Attach an image');
    if (file.size > MAX_UPLOAD_BYTES) throw bad('UPLOAD_TOO_LARGE', 'The image is too large (4 MB at most)');
    const mime = sniffImage(file.buffer);
    if (!mime) throw bad('UPLOAD_TYPE', 'Only JPEG, PNG or WebP images');

    const proofId = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOwn(tx, id, userId);
      if (order.status !== 'AWAITING_PAYMENT' && order.status !== 'UNDER_REVIEW') throw wrongStatus(order.status);
      if (order.proofUploadId) await tx.upload.deleteMany({ where: { id: order.proofUploadId, kind: USDT_PROOF_KIND } });
      const upload = await tx.upload.create({
        data: { kind: USDT_PROOF_KIND, mime, size: file.size, data: new Uint8Array(file.buffer), isPublic: false, userId },
        select: { id: true },
      });
      await tx.usdtOrder.update({ where: { id }, data: { proofUploadId: upload.id } });
      await this.event(tx, id, { action: 'proof.attached', actorId: userId });
      await this.audit.record(tx, { actorId: userId, action: 'usdt.order.proof', entityType: 'UsdtOrder', entityId: id });
      return upload.id;
    });
    return { proofId };
  }

  /**
   * The customer reports their transfer (receipt already attached). Allowed
   * again while staff have not looked at it, to correct a typo.
   */
  async submitPayment(userId: string, id: string, dto: SubmitUsdtPaymentDto) {
    const account = (await this.accounts()).find((a) => a.id === dto.method);
    if (!account) throw bad('USDT_PAYMENT_METHOD_UNKNOWN', 'Choose one of the shop\'s transfer accounts');

    let expired = false;
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOwn(tx, id, userId);
      if (order.status === 'AWAITING_PAYMENT' && order.expiresAt && order.expiresAt <= new Date()) {
        await this.move(tx, order, { to: 'CANCELLED', action: 'expired', actorId: null, audit: 'usdt.order.expire' });
        expired = true;
        return null;
      }
      if (order.status !== 'AWAITING_PAYMENT' && order.status !== 'UNDER_REVIEW') throw wrongStatus(order.status);
      if (!order.proofUploadId) throw bad('USDT_PROOF_REQUIRED', 'Attach a screenshot of the transfer');

      const set = {
        paymentMethod: account.method,
        payerPhone: dto.payerPhone,
        paymentRef: dto.reference || null,
        paidAt: new Date(),
      };
      const data = { accountId: account.id, accountNumber: account.accountNumber };
      if (order.status === 'UNDER_REVIEW') {
        await tx.usdtOrder.update({ where: { id }, data: set });
        await this.event(tx, id, { action: 'payment.updated', actorId: userId, data });
        await this.audit.record(tx, { actorId: userId, action: 'usdt.order.payment_update', entityType: 'UsdtOrder', entityId: id, after: { ...set, ...data } });
        return order;
      }
      await this.move(tx, order, { to: 'UNDER_REVIEW', action: 'payment.submitted', actorId: userId, data, set, audit: 'usdt.order.payment' });
      return order;
    });
    if (expired) throw bad('USDT_ORDER_EXPIRED', 'This order expired before payment. Start a new one.');

    await this.staff.notify({
      type: 'usdt.review',
      priority: 'HIGH',
      title: `طلب USDT بانتظار المراجعة ${result!.number}`,
      body: `${result!.amountUsdt.toFixed(2)} USDT مقابل ${result!.total.toString()} ${result!.currency} عبر ${account.method}. تحقّق من وصول المبلغ.`,
      link: `/usdt/${id}`,
      dedupeKey: reviewKey(id),
      entityType: 'UsdtOrder',
      entityId: id,
    });
    return this.forCustomer(id, userId);
  }

  async cancel(userId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOwn(tx, id, userId);
      if (order.status !== 'AWAITING_PAYMENT' && order.status !== 'NEW') throw wrongStatus(order.status);
      await this.move(tx, order, { to: 'CANCELLED', action: 'cancelled', actorId: userId, audit: 'usdt.order.cancel' });
    });
    return this.forCustomer(id, userId);
  }

  /** Transfer accounts the customer can pay into (the same list as checkout, minus crypto ones). */
  private async accounts(): Promise<ManualAccount[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_ACCOUNTS_KEY } });
    const all = Array.isArray(row?.value) ? (row.value as unknown as ManualAccount[]).map(normalizeAccount) : [];
    // paying for USDT with crypto would be a swap, not a sale
    return all.filter((a) => isUsable(a) && a.kind !== 'crypto');
  }

  // ───────────────────────── staff ─────────────────────────

  async list(q: UsdtOrdersQueryDto) {
    const page = q.page ?? 1;
    const limit = q.limit ?? 30;
    const s = q.search?.trim();
    const where: Prisma.UsdtOrderWhereInput = {
      ...(q.status && { status: q.status }),
      ...(s && {
        OR: [
          { number: { contains: s, mode: 'insensitive' } },
          { address: { contains: s, mode: 'insensitive' } },
          { binanceId: { contains: s, mode: 'insensitive' } },
          { txid: { contains: s, mode: 'insensitive' } },
          { user: { phone: { contains: s.replace(/[^\d+]/g, '') || s } } },
        ],
      }),
    };
    const [rows, total, counts] = await Promise.all([
      this.prisma.usdtOrder.findMany({
        where,
        // the oldest waiting order first while working a queue; newest first for history
        orderBy: { createdAt: q.status && ['UNDER_REVIEW', 'READY_TO_SEND'].includes(q.status) ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { user: { select: { id: true, fullName: true, phone: true } } },
      }),
      this.prisma.usdtOrder.count({ where }),
      this.prisma.usdtOrder.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      data: rows.map((o) => ({ ...this.staffView(o), user: o.user })),
      total,
      page,
      limit,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  async detail(id: string) {
    const order = await this.prisma.usdtOrder.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, phone: true, email: true, phoneVerifiedAt: true, createdAt: true } },
        reviewedBy: { select: { id: true, fullName: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw notFound();
    const actorIds = [...new Set(order.events.map((e) => e.actorId).filter((x): x is string => !!x))];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const name = new Map(actors.map((a) => [a.id, a.fullName]));
    const previous = await this.prisma.usdtOrder.count({ where: { userId: order.userId, status: 'COMPLETED', id: { not: order.id } } });
    return {
      ...this.staffView(order),
      user: order.user,
      reviewedBy: order.reviewedBy,
      previousCompleted: previous,
      events: order.events.map((e) => ({
        id: e.id,
        action: e.action,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        note: e.note,
        data: e.data,
        actorId: e.actorId,
        actorName: e.actorId ? (name.get(e.actorId) ?? null) : null,
        createdAt: e.createdAt,
      })),
    };
  }

  private staffView(o: UsdtOrder) {
    const { idempotencyKey: _k, proofUploadId, ...rest } = o;
    void _k;
    return {
      ...rest,
      amountUsdt: o.amountUsdt.toFixed(2),
      rate: o.rate.toString(),
      subtotal: o.subtotal.toString(),
      fee: o.fee.toString(),
      total: o.total.toString(),
      hasProof: !!proofUploadId,
    };
  }

  async proof(id: string) {
    const order = await this.prisma.usdtOrder.findUnique({ where: { id }, select: { proofUploadId: true } });
    if (!order) throw notFound();
    const row = order.proofUploadId
      ? await this.prisma.upload.findFirst({ where: { id: order.proofUploadId, kind: USDT_PROOF_KIND }, select: { mime: true, data: true } })
      : null;
    if (!row) throw new NotFoundException({ message: 'No receipt for this order', error: 'USDT_PROOF_MISSING' });
    return row;
  }

  /** The money arrived: the order is cleared for sending (still by hand). */
  async approve(actorId: string, id: string) {
    const order = await this.prisma.$transaction(async (tx) => {
      const o = await this.lock(tx, id);
      if (o.status !== 'UNDER_REVIEW') throw wrongStatus(o.status);
      if (!o.proofUploadId) throw bad('USDT_PROOF_REQUIRED', 'The customer has not attached a receipt');
      await this.move(tx, o, { to: 'READY_TO_SEND', action: 'approved', actorId, set: { reviewedById: actorId, approvedAt: new Date() } });
      return o;
    });
    await this.staff.resolve(reviewKey(id));
    const where = order.delivery === 'BINANCE' ? `Binance ${order.binanceId}` : `${order.network} ${order.address}`;
    await this.staff.notify({
      type: 'usdt.send',
      priority: 'HIGH',
      title: `أرسل ${order.amountUsdt.toFixed(2)} USDT للطلب ${order.number}`,
      body: `الدفع مؤكَّد. أرسل يدويًا إلى ${where} ثم سجّل رقم العملية (TXID).`,
      link: `/usdt/${id}`,
      dedupeKey: sendKey(id),
      entityType: 'UsdtOrder',
      entityId: id,
    });
    return this.detail(id);
  }

  /** Staff sent the USDT themselves and record the transaction id. */
  async complete(actorId: string, id: string, txidInput: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const o = await this.lock(tx, id);
        if (o.status !== 'READY_TO_SEND') throw wrongStatus(o.status);
        const check = validateTxid(o.delivery, o.network, txidInput);
        if (!check.ok) throw bad(check.code, check.message);
        const taken = await tx.usdtOrder.findUnique({ where: { txid: check.value }, select: { number: true } });
        if (taken) throw this.duplicateTxid(taken.number);
        await this.move(tx, o, { to: 'COMPLETED', action: 'completed', actorId, data: { txid: check.value }, set: { txid: check.value, completedAt: new Date() } });
      });
    } catch (e) {
      // two orders completed with one TXID at the same moment: the unique index decides
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw this.duplicateTxid();
      throw e;
    }
    await this.staff.resolve(sendKey(id));
    return this.detail(id);
  }

  private duplicateTxid(number?: string) {
    return new ConflictException({
      message: number ? `This TXID is already recorded on order ${number}` : 'This TXID is already recorded on another order',
      error: 'USDT_TXID_DUPLICATE',
    });
  }

  async reject(actorId: string, id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.lock(tx, id);
      if (!canMove(o.status, 'REJECTED')) throw wrongStatus(o.status);
      await this.move(tx, o, { to: 'REJECTED', action: 'rejected', actorId, note: reason, set: { rejectReason: reason, reviewedById: actorId } });
    });
    await this.staff.resolve(reviewKey(id));
    await this.staff.resolve(sendKey(id));
    return this.detail(id);
  }

  /** Unpaid orders past their deadline are cancelled (run by the repeatable job). */
  async expireUnpaid(now = new Date()): Promise<number> {
    const due = await this.prisma.usdtOrder.findMany({
      where: { status: 'AWAITING_PAYMENT', expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    let expired = 0;
    for (const { id } of due) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          const o = await this.lock(tx, id);
          // paid (or cancelled) between the scan and the lock: leave it alone
          if (o.status !== 'AWAITING_PAYMENT' || !o.expiresAt || o.expiresAt > now) return false;
          await this.move(tx, o, { to: 'CANCELLED', action: 'expired', actorId: null, audit: 'usdt.order.expire' });
          return true;
        });
        if (done) expired++;
      } catch (e) {
        this.log.warn(`USDT order ${id} not expired: ${e instanceof Error ? e.message : e}`);
      }
    }
    return expired;
  }

  // ───────────────────────── internals ─────────────────────────

  private async lock(tx: TxClient, id: string): Promise<UsdtOrder> {
    await tx.$queryRaw`SELECT "id" FROM "usdt_orders" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const order = await tx.usdtOrder.findUnique({ where: { id } });
    if (!order) throw notFound();
    return order;
  }

  /** Someone else's order looks exactly like a missing one. */
  private async lockOwn(tx: TxClient, id: string, userId: string): Promise<UsdtOrder> {
    const order = await this.lock(tx, id);
    if (order.userId !== userId) throw notFound();
    return order;
  }

  /** The one way a status changes: checked, conditional on the old status, evented and audited. */
  private async move(tx: TxClient, order: UsdtOrder, m: Move) {
    if (!canMove(order.status, m.to)) throw wrongStatus(order.status);
    const { count } = await tx.usdtOrder.updateMany({
      where: { id: order.id, status: order.status },
      data: { ...m.set, status: m.to },
    });
    if (count !== 1) throw wrongStatus(order.status);
    await this.event(tx, order.id, { action: m.action, from: order.status, to: m.to, actorId: m.actorId, note: m.note, data: m.data });
    await this.audit.record(tx, {
      actorId: m.actorId ?? undefined,
      action: m.audit ?? `usdt.${m.action}`,
      entityType: 'UsdtOrder',
      entityId: order.id,
      before: { status: order.status },
      after: { status: m.to, ...(m.note && { note: m.note }), ...m.data },
    });
  }

  private event(
    tx: TxClient,
    usdtOrderId: string,
    e: { action: string; from?: UsdtOrderStatus; to?: UsdtOrderStatus; actorId: string | null; note?: string; data?: Record<string, unknown> },
  ) {
    return tx.usdtOrderEvent.create({
      data: {
        usdtOrderId,
        action: e.action,
        fromStatus: e.from ?? null,
        toStatus: e.to ?? null,
        actorId: e.actorId,
        note: e.note ?? null,
        data: e.data ? (JSON.parse(JSON.stringify(e.data)) as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  }
}
