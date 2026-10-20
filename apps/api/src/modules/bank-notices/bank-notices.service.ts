import { createHash } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BankNoticeStatus, BankNotification, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { MAX_TITLE, parseNotice, sanitizeNotice } from './bank-notice.parser';
import { PaymentCandidate, matchPayment } from './bank-notice.matcher';
import { IngestBankNoticeDto } from './dto/bank-notices.dto';

/** System setting: package names of the bank apps the admin phone may forward. Empty = none. */
export const ALLOWED_APPS_KEY = 'bank.allowed_apps';
/** How far back a waiting manual payment can be suggested for a notice. */
export const MATCH_WINDOW_HOURS = 48;
const DEFAULT_LIMIT = 50;
const OPEN: BankNoticeStatus[] = ['NEW', 'SUGGESTED'];

/** sha256(deviceId|sourceApp|text|postedAt), over the sanitized text: the same notification sent twice. */
export function noticeFingerprint(deviceId: string, sourceApp: string, text: string, postedAt: Date) {
  return createHash('sha256').update(`${deviceId}|${sourceApp}|${text}|${postedAt.toISOString()}`).digest('hex');
}

type PaymentBrief = { id: string; orderId: string; orderNumber: string; amount: string; currency: string; status: string };

/**
 * Payment notifications the owner's Android phone read from the bank apps they
 * chose. Evidence for the owner, never proof of payment: a notice can point at
 * the order it probably belongs to, and the owner can record that link, but the
 * payment itself is still approved by a person through the payments approve
 * endpoint. Nothing in this module changes a payment or an order.
 */
@Injectable()
export class BankNoticesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private staff: StaffNotificationsService,
  ) {}

  // ── config ──

  async allowedApps(): Promise<string[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: ALLOWED_APPS_KEY } });
    return Array.isArray(row?.value) ? row.value.filter((v): v is string => typeof v === 'string') : [];
  }

  async config() {
    return { allowedApps: await this.allowedApps() };
  }

  async setConfig(allowedApps: string[], actorId: string) {
    const apps = [...new Set(allowedApps.map((a) => a.trim()))].sort();
    const before = await this.allowedApps();
    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: ALLOWED_APPS_KEY },
        update: { value: apps },
        create: {
          key: ALLOWED_APPS_KEY, value: apps, group: 'payments', isPublic: false,
          description: 'Bank apps whose payment notifications the admin phone may forward',
        },
      });
      await this.audit.record(tx, {
        actorId, action: 'bank_notices.config', entityType: 'SystemSetting', entityId: ALLOWED_APPS_KEY,
        before: { allowedApps: before }, after: { allowedApps: apps },
      });
    });
    return { allowedApps: apps };
  }

  // ── ingest ──

  async ingest(dto: IngestBankNoticeDto, actorId: string) {
    const allowed = (await this.allowedApps()).map((a) => a.toLowerCase());
    if (!allowed.includes(dto.sourceApp.toLowerCase())) {
      throw new BadRequestException({ message: 'This app is not in the list of allowed bank apps', error: 'BANK_APP_NOT_ALLOWED' });
    }

    // secrets out before anything is hashed, stored or parsed
    const text = sanitizeNotice(dto.text);
    const title = dto.title ? sanitizeNotice(dto.title, MAX_TITLE) || null : null;
    if (!text) throw new BadRequestException({ message: 'The notification has no text', error: 'BANK_NOTICE_EMPTY' });
    const postedAt = new Date(dto.postedAt);
    const fingerprint = noticeFingerprint(dto.deviceId, dto.sourceApp, text, postedAt);

    const existing = await this.prisma.bankNotification.findUnique({ where: { fingerprint } });
    if (existing) return this.ingestResult(existing, true);

    const parsed = parseNotice(title ? `${title} ${text}` : text);
    const now = new Date();

    let status: BankNoticeStatus = 'NEW';
    let duplicateOfId: string | null = null;
    let suggestedPaymentId: string | null = null;

    // the same transfer reported again (another app, a re-sent SMS): kept, flagged, never matched twice
    const first = parsed.reference
      ? await this.prisma.bankNotification.findFirst({ where: { reference: parsed.reference }, orderBy: { receivedAt: 'asc' }, select: { id: true } })
      : null;
    if (first) {
      status = 'DUPLICATE';
      duplicateOfId = first.id;
    } else if (parsed.direction !== 'out' && parsed.amount && parsed.currency) {
      const match = matchPayment(parsed, await this.candidates(parsed.amount, parsed.currency, now));
      if (match) {
        status = 'SUGGESTED';
        suggestedPaymentId = match.paymentId;
      }
    }

    let row: BankNotification;
    try {
      row = await this.prisma.bankNotification.create({
        data: {
          deviceId: dto.deviceId, sourceApp: dto.sourceApp, title, text, postedAt, receivedAt: now,
          amount: parsed.amount, currency: parsed.currency, reference: parsed.reference, sender: parsed.sender,
          confidence: parsed.confidence, parser: parsed.parser,
          status, fingerprint, duplicateOfId, suggestedPaymentId,
        },
      });
    } catch (e) {
      // the phone sent the same notification twice at the same moment
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.ingestResult(await this.prisma.bankNotification.findUniqueOrThrow({ where: { fingerprint } }), true);
      }
      throw e;
    }

    await this.audit.recordAsync({
      actorId, action: 'bank_notices.ingest', entityType: 'BankNotification', entityId: row.id,
      after: { sourceApp: row.sourceApp, status: row.status, confidence: row.confidence },
    });
    await this.raiseNotice(row, parsed.direction);
    return this.ingestResult(row, false);
  }

  private ingestResult(row: BankNotification, duplicate: boolean) {
    return {
      id: row.id,
      status: row.status,
      duplicate,
      amount: row.amount?.toString() ?? null,
      currency: row.currency,
      reference: row.reference,
      confidence: row.confidence,
    };
  }

  /** MANUAL payments still waiting (started or reported) in the last 48 h, for the same amount and currency. */
  private async candidates(amount: string, currency: string, now: Date): Promise<PaymentCandidate[]> {
    const rows = await this.prisma.payment.findMany({
      where: {
        gateway: 'MANUAL',
        status: { in: ['INITIATED', 'AUTHORIZED'] },
        createdAt: { gte: new Date(now.getTime() - MATCH_WINDOW_HOURS * 3_600_000) },
        currency,
        amount: new Prisma.Decimal(amount),
      },
      select: { id: true, amount: true, currency: true, status: true, rawResponse: true, createdAt: true },
      take: 50,
    });
    return rows.map(({ rawResponse, ...p }) => {
      const raw = rawResponse as { transfer?: { reference?: unknown; payerPhone?: unknown } } | null;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return { ...p, reference: str(raw?.transfer?.reference), payerPhone: str(raw?.transfer?.payerPhone) };
    });
  }

  private async raiseNotice(row: BankNotification, direction: string) {
    const what = row.amount ? `${row.amount.toString()} ${row.currency ?? ''}`.trim() : 'مبلغ غير مقروء';
    if (row.status === 'SUGGESTED' && row.suggestedPaymentId) {
      const payment = await this.prisma.payment.findUnique({
        where: { id: row.suggestedPaymentId },
        select: { orderId: true, order: { select: { orderNumber: true } } },
      });
      await this.staff.notify({
        type: 'bank.match',
        priority: 'NORMAL',
        title: `إشعار بنكي قد يخص الطلب ${payment?.order.orderNumber ?? ''}`.trim(),
        body: `وصل ${what} عبر ${row.sourceApp}. تأكّد بنفسك من التحويل ثم وافق على الدفع من صفحة الطلب — الإشعار وحده ليس دليلاً.`,
        link: '/bank-notices',
        dedupeKey: `bank.match:${row.id}`,
        entityType: 'BankNotification',
        entityId: row.id,
        data: { paymentId: row.suggestedPaymentId, orderId: payment?.orderId ?? null },
      });
    } else if (row.status === 'NEW' && direction !== 'out') {
      await this.staff.notify({
        type: 'bank.unmatched',
        priority: 'NORMAL',
        title: 'إشعار بنكي بلا طلب مطابق',
        body: `وصل ${what} عبر ${row.sourceApp} ولم نجد دفعة تنتظر بنفس المبلغ. راجعه.`,
        link: '/bank-notices',
        dedupeKey: `bank.unmatched:${row.id}`,
        entityType: 'BankNotification',
        entityId: row.id,
      });
    }
  }

  // ── review ──

  async list(status?: BankNoticeStatus, limit = DEFAULT_LIMIT) {
    const order: Prisma.BankNotificationOrderByWithRelationInput = { receivedAt: 'desc' };
    let rows: BankNotification[];
    if (status) {
      rows = await this.prisma.bankNotification.findMany({ where: { status }, orderBy: order, take: limit });
    } else {
      // what still needs the owner (unmatched, suggested) first, then the rest
      const open = await this.prisma.bankNotification.findMany({ where: { status: { in: OPEN } }, orderBy: order, take: limit });
      const rest = open.length < limit
        ? await this.prisma.bankNotification.findMany({ where: { status: { notIn: OPEN } }, orderBy: order, take: limit - open.length })
        : [];
      rows = [...open, ...rest];
    }
    const briefs = await this.paymentBriefs(rows.flatMap((r) => [r.suggestedPaymentId, r.matchedPaymentId]));
    return { data: rows.map((r) => this.view(r, briefs)) };
  }

  private async paymentBriefs(ids: Array<string | null>) {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map<string, PaymentBrief>();
    const rows = await this.prisma.payment.findMany({
      where: { id: { in: wanted } },
      select: { id: true, orderId: true, amount: true, currency: true, status: true, order: { select: { orderNumber: true } } },
    });
    return new Map(rows.map((p) => [p.id, {
      id: p.id, orderId: p.orderId, orderNumber: p.order.orderNumber, amount: p.amount.toString(), currency: p.currency, status: p.status,
    }]));
  }

  private view(r: BankNotification, briefs: Map<string, PaymentBrief>) {
    const suggested = r.suggestedPaymentId ? briefs.get(r.suggestedPaymentId) ?? null : null;
    const matched = r.matchedPaymentId ? briefs.get(r.matchedPaymentId) ?? null : null;
    // the order it is (or probably is) about, flat: the Android admin app links to it
    const about = matched ?? suggested;
    return {
      id: r.id,
      deviceId: r.deviceId,
      sourceApp: r.sourceApp,
      title: r.title,
      text: r.text,
      postedAt: r.postedAt,
      receivedAt: r.receivedAt,
      amount: r.amount?.toString() ?? null,
      currency: r.currency,
      reference: r.reference,
      sender: r.sender,
      confidence: r.confidence,
      parser: r.parser,
      status: r.status,
      duplicate: r.status === 'DUPLICATE',
      duplicateOfId: r.duplicateOfId,
      suggestedPaymentId: r.suggestedPaymentId,
      matchedPaymentId: r.matchedPaymentId,
      suggestedPayment: suggested,
      matchedPayment: matched,
      orderId: about?.orderId ?? null,
      orderNumber: about?.orderNumber ?? null,
      reviewedById: r.reviewedById,
      reviewedAt: r.reviewedAt,
      reviewNote: r.reviewNote,
    };
  }

  private async one(id: string) {
    const row = await this.prisma.bankNotification.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ message: 'Bank notice not found', error: 'BANK_NOTICE_NOT_FOUND' });
    return row;
  }

  private async viewOne(id: string) {
    const row = await this.one(id);
    return this.view(row, await this.paymentBriefs([row.suggestedPaymentId, row.matchedPaymentId]));
  }

  /**
   * The owner says this notice is the money of that payment. Only the link is
   * recorded (matchedPaymentId, who, when): the payment stays as it is and is
   * approved — or not — through the payments approve endpoint, by a person.
   */
  async confirm(id: string, paymentId: string, actorId: string) {
    const notice = await this.one(id);
    if (notice.status === 'DUPLICATE') {
      throw new BadRequestException({ message: 'This notice repeats another one; confirm the first one', error: 'BANK_NOTICE_DUPLICATE' });
    }
    if (!OPEN.includes(notice.status)) {
      throw new BadRequestException({ message: 'This notice was already reviewed', error: 'BANK_NOTICE_REVIEWED' });
    }

    await this.prisma.$transaction(async (tx) => {
      // one notice per payment: two people confirming two notices for the same payment wait for each other
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bank-notice-payment:${paymentId}`}))`;
      const payment = await tx.payment.findUnique({ where: { id: paymentId }, select: { id: true, gateway: true } });
      if (!payment || payment.gateway !== 'MANUAL') {
        throw new BadRequestException({ message: 'Pick a manual transfer payment', error: 'BANK_NOTICE_PAYMENT_INVALID' });
      }
      const taken = await tx.bankNotification.findFirst({
        where: { matchedPaymentId: paymentId, status: 'CONFIRMED', id: { not: id } },
        select: { id: true },
      });
      if (taken) {
        throw new BadRequestException({ message: 'Another bank notice is already linked to this payment', error: 'BANK_NOTICE_PAYMENT_TAKEN' });
      }
      const { count } = await tx.bankNotification.updateMany({
        where: { id, status: { in: OPEN } },
        data: { status: 'CONFIRMED', matchedPaymentId: paymentId, reviewedById: actorId, reviewedAt: new Date() },
      });
      if (!count) throw new BadRequestException({ message: 'This notice was already reviewed', error: 'BANK_NOTICE_REVIEWED' });
      await this.audit.record(tx, {
        actorId, action: 'bank_notices.confirm', entityType: 'BankNotification', entityId: id,
        before: { status: notice.status, suggestedPaymentId: notice.suggestedPaymentId },
        after: { status: 'CONFIRMED', matchedPaymentId: paymentId },
      });
    });
    await this.closeNotices(id);
    return this.viewOne(id);
  }

  async ignore(id: string, actorId: string, note?: string) {
    const notice = await this.one(id);
    const { count } = await this.prisma.$transaction(async (tx) => {
      const res = await tx.bankNotification.updateMany({
        where: { id, status: { in: [...OPEN, 'DUPLICATE'] } },
        data: { status: 'IGNORED', reviewedById: actorId, reviewedAt: new Date(), reviewNote: note?.trim() || null },
      });
      if (res.count) {
        await this.audit.record(tx, {
          actorId, action: 'bank_notices.ignore', entityType: 'BankNotification', entityId: id,
          before: { status: notice.status }, after: { status: 'IGNORED', note: note ?? null },
        });
      }
      return res;
    });
    if (!count) throw new BadRequestException({ message: 'This notice was already reviewed', error: 'BANK_NOTICE_REVIEWED' });
    await this.closeNotices(id);
    return this.viewOne(id);
  }

  private async closeNotices(id: string) {
    await this.staff.resolve(`bank.match:${id}`);
    await this.staff.resolve(`bank.unmatched:${id}`);
  }
}
