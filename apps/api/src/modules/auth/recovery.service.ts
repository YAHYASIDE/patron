import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecoveryStatus, VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { toAuditJson } from '../../common/audit/audit.service';
import { StaffNotificationsService } from '../staff-notifications/staff-notifications.service';
import { CodesService, Destination, invalidCode } from './codes.service';
import { LoginGuardService } from './login-guard.service';
import { TokenService } from './token.service';
import { RequestMeta } from './auth.service';
import { accountWhere, maskContact, parseIdentifier } from './identifier';
import { RecoveryCompleteDto, RecoveryRequestDto } from './dto/auth.dto';

const OPEN: RecoveryStatus[] = [RecoveryStatus.PENDING, RecoveryStatus.VERIFIED];
/** Open requests one contact may have in a day; more answer the same but store nothing. */
const MAX_OPEN_PER_CONTACT = 3;

const noticeKey = (id: string) => `recovery.new:${id}`;

/**
 * Support-assisted account recovery for a customer who lost their number,
 * email or password.
 *
 * 1. The customer files a request (public, throttled, same answer whether an
 *    account matches or not).
 * 2. Staff with `recovery.review` compare the proof with the account's orders
 *    and verify or reject. Verifying makes the system send a reset code to the
 *    contact the customer gave (or the account's own) through the providers —
 *    never the owner-relay page: staff never see the code or the password, and
 *    no route lets them set one.
 * 3. The customer proves the code and chooses a password; a new contact
 *    becomes the account's (verified) contact.
 * Every step is audited.
 */
@Injectable()
export class RecoveryService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private codes: CodesService,
    private guard: LoginGuardService,
    private tokens: TokenService,
    private staff: StaffNotificationsService,
  ) {}

  // ─────────────── Customer ───────────────

  async request(dto: RecoveryRequestDto, meta: RequestMeta) {
    const contact = parseIdentifier(dto.contact);
    const newContact = dto.newContact?.trim() ? parseIdentifier(dto.newContact) : null;
    const answer = {
      message: 'Request received. If the details match an account, our team will check them and send a code to the contact you gave.',
    };

    const user = await this.prisma.user.findFirst({ where: accountWhere(contact), select: { id: true } });
    const open = await this.prisma.accountRecoveryRequest.count({
      where: { contact: contact.to, status: RecoveryStatus.PENDING, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
    });
    if (open >= MAX_OPEN_PER_CONTACT) return answer;

    const row = await this.prisma.accountRecoveryRequest.create({
      data: {
        userId: user?.id ?? null,
        contact: contact.to,
        fullName: dto.fullName.trim(),
        proof: dto.proof.trim(),
        newContact: newContact && newContact.to !== contact.to ? newContact.to : null,
        ipAddress: meta.ip,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: user?.id ?? null, action: 'recovery.requested', entityType: 'AccountRecoveryRequest', entityId: row.id,
        ipAddress: meta.ip, userAgent: meta.userAgent,
      },
    });
    await this.staff.notify({
      type: 'recovery.new',
      priority: 'HIGH',
      title: 'طلب استعادة حساب',
      body: `${row.fullName} يطلب استعادة الحساب ${maskContact(contact)}${user ? '' : ' (لا يوجد حساب بهذه البيانات)'}`,
      link: `/recovery?id=${row.id}`,
      dedupeKey: noticeKey(row.id),
      entityType: 'AccountRecoveryRequest',
      entityId: row.id,
    });
    return answer;
  }

  /** The customer proves the code that reached them and chooses a new password. */
  async complete(dto: RecoveryCompleteDto, meta: RequestMeta) {
    const dest = parseIdentifier(dto.contact);
    await this.guard.assertAllowed(dest.to, meta.ip);

    const req = await this.prisma.accountRecoveryRequest.findFirst({
      where: {
        status: RecoveryStatus.VERIFIED,
        userId: { not: null },
        OR: [{ newContact: dest.to }, { newContact: null, contact: dest.to }],
      },
      orderBy: { reviewedAt: 'desc' },
    });
    try {
      if (!req?.userId) throw invalidCode();
      await this.codes.consume(req.userId, VerificationPurpose.ACCOUNT_RECOVERY, dto.code, dest);
    } catch (err) {
      await this.guard.recordFailure(dest.to, meta.ip, 'invalid_recovery_code');
      throw err;
    }
    await this.guard.recordSuccess(dest.to, meta.ip);
    const userId = req.userId;

    const now = new Date();
    // the code reached this contact: it becomes (or stays) the account's, verified
    const contactData: Prisma.UserUpdateInput =
      dest.kind === 'email' ? { email: dest.to, emailVerifiedAt: now } : { phone: dest.to, phoneVerifiedAt: now };
    const passwordHash = await this.crypto.hashPassword(dto.newPassword);
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: userId }, data: { passwordHash, ...contactData } }),
        this.prisma.accountRecoveryRequest.update({
          where: { id: req.id },
          data: { status: RecoveryStatus.COMPLETED, completedAt: now },
        }),
      ]);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'RECOVERY_CONTACT_TAKEN', message: 'That contact now belongs to another account' });
      }
      throw e;
    }
    await this.tokens.revokeAllForUser(userId);
    await this.prisma.auditLog.create({
      data: {
        userId, action: 'recovery.completed', entityType: 'AccountRecoveryRequest', entityId: req.id,
        after: toAuditJson({ contact: maskContact(dest), contactChanged: !!req.newContact }),
        ipAddress: meta.ip, userAgent: meta.userAgent,
      },
    });
    return { message: 'Account recovered — sign in with your new password', identifier: dest.to };
  }

  // ─────────────── Staff ───────────────

  /** Requests with the account and its recent orders, so the proof can be compared. */
  async list(status?: RecoveryStatus) {
    const rows = await this.prisma.accountRecoveryRequest.findMany({
      where: status ? { status } : { status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        reviewedBy: { select: { id: true, fullName: true } },
        user: {
          select: {
            id: true, fullName: true, phone: true, email: true, phoneVerifiedAt: true, emailVerifiedAt: true,
            createdAt: true, isBlocked: true, lastLoginAt: true, country: true, city: true,
            _count: { select: { orders: true } },
            orders: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              select: {
                id: true, orderNumber: true, status: true, total: true, currency: true, createdAt: true,
                items: { select: { productNameAr: true, quantity: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((r) => {
      const dest = this.destinationOf(r);
      return {
        ...r,
        destination: dest ? { kind: dest.kind, masked: maskContact(dest), canSend: this.codes.canDeliverPrivately(dest) } : null,
      };
    });
  }

  async verify(id: string, actorId: string, note: string | undefined, meta: RequestMeta) {
    const req = await this.prisma.accountRecoveryRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: 'RECOVERY_NOT_FOUND', message: 'Request not found' });
    if (!OPEN.includes(req.status)) throw new ConflictException({ error: 'RECOVERY_CLOSED', message: 'This request is already closed' });

    const user = req.userId ? await this.prisma.user.findFirst({ where: { id: req.userId, deletedAt: null } }) : null;
    if (!user) {
      throw new ConflictException({ error: 'RECOVERY_NO_ACCOUNT', message: 'No account matches this request; reject it or ask the customer for the right contact' });
    }
    const dest = this.destinationOf(req) as Destination;
    if (!this.codes.canDeliverPrivately(dest)) {
      throw new ConflictException({
        error: 'RECOVERY_CHANNEL_UNAVAILABLE',
        channel: dest.kind,
        message: dest.kind === 'email'
          ? 'Email sending is not set up (RESEND_API_KEY, EMAIL_FROM)'
          : 'Automatic SMS is not set up (OTP_PROVIDER=twilio_verify and the Twilio keys)',
      });
    }
    if (req.newContact) {
      const taken = await this.prisma.user.findFirst({ where: { ...accountWhere(dest), id: { not: user.id } }, select: { id: true } });
      if (taken) throw new ConflictException({ error: 'RECOVERY_CONTACT_TAKEN', message: 'The new contact belongs to another account' });
    }

    // flip first: two staff clicking together send one code
    let flipped = false;
    if (req.status === RecoveryStatus.PENDING) {
      const { count } = await this.prisma.accountRecoveryRequest.updateMany({
        where: { id, status: RecoveryStatus.PENDING },
        data: { status: RecoveryStatus.VERIFIED, reviewedById: actorId, reviewNote: note?.trim() || null, reviewedAt: new Date() },
      });
      if (count !== 1) throw new ConflictException({ error: 'RECOVERY_CLOSED', message: 'This request was reviewed meanwhile' });
      flipped = true;
    }
    try {
      // private: the owner-relay channel is refused, staff never read this code
      await this.codes.issue(user, VerificationPurpose.ACCOUNT_RECOVERY, dest, { private: true });
    } catch (e) {
      if (flipped) {
        await this.prisma.accountRecoveryRequest.update({
          where: { id },
          data: { status: RecoveryStatus.PENDING, reviewedById: null, reviewNote: null, reviewedAt: null },
        });
      }
      throw e;
    }

    await this.prisma.auditLog.create({
      data: {
        userId: actorId, action: flipped ? 'recovery.verified' : 'recovery.code_resent',
        entityType: 'AccountRecoveryRequest', entityId: id,
        after: toAuditJson({ accountId: user.id, sentTo: maskContact(dest), channel: dest.kind, note: note?.trim() || undefined }),
        ipAddress: meta.ip, userAgent: meta.userAgent,
      },
    });
    await this.staff.resolve(noticeKey(id));
    return { status: RecoveryStatus.VERIFIED, sentTo: maskContact(dest), channel: dest.kind };
  }

  async reject(id: string, actorId: string, note: string | undefined, meta: RequestMeta) {
    const req = await this.prisma.accountRecoveryRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException({ error: 'RECOVERY_NOT_FOUND', message: 'Request not found' });
    const { count } = await this.prisma.accountRecoveryRequest.updateMany({
      where: { id, status: { in: OPEN } },
      data: { status: RecoveryStatus.REJECTED, reviewedById: actorId, reviewNote: note?.trim() || null, reviewedAt: new Date() },
    });
    if (count !== 1) throw new ConflictException({ error: 'RECOVERY_CLOSED', message: 'This request is already closed' });

    // a code already sent for it stops working
    if (req.userId) {
      await this.prisma.verificationToken.updateMany({
        where: { userId: req.userId, purpose: VerificationPurpose.ACCOUNT_RECOVERY, consumedAt: null },
        data: { consumedAt: new Date() },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        userId: actorId, action: 'recovery.rejected', entityType: 'AccountRecoveryRequest', entityId: id,
        after: toAuditJson({ note: note?.trim() || undefined }),
        ipAddress: meta.ip, userAgent: meta.userAgent,
      },
    });
    await this.staff.resolve(noticeKey(id));
    return { status: RecoveryStatus.REJECTED };
  }

  private destinationOf(r: { contact: string; newContact: string | null }): Destination | null {
    try {
      return parseIdentifier(r.newContact ?? r.contact);
    } catch {
      return null;
    }
  }
}
