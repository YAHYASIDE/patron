import {
  BadGatewayException, BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SMS_SENDER, SmsSender } from './senders/sms-sender';
import { EMAIL_SENDER, EmailSender } from './senders/email-sender';
import { codeEmail } from './senders/messages';

/** Where a code goes: an E.164 number or an email address. */
export interface Destination {
  kind: 'phone' | 'email';
  to: string;
}

export type IssueResult = 'SENT' | 'REUSED' | 'COOLDOWN';

/** Rows whose code only the provider knows (Twilio Verify) carry this instead of a digest. */
const PROVIDER_PREFIX = 'provider:';

export const invalidCode = () =>
  new BadRequestException({ error: 'INVALID_CODE', message: 'Invalid or expired code' });

export const emailNotConfigured = () =>
  new BadRequestException({ error: 'EMAIL_NOT_CONFIGURED', message: 'Email codes are not available yet' });

/**
 * One-time codes for every purpose (sign-in, verification, reset, recovery):
 * random 6 digits, stored as a SHA-256 digest, short-lived, attempt-limited and
 * single use. Delivery goes through the configured providers; the code itself
 * never reaches a log, a response or the audit trail.
 */
@Injectable()
export class CodesService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private config: ConfigService,
    @Inject(SMS_SENDER) private sms: SmsSender,
    @Inject(EMAIL_SENDER) private email: EmailSender,
  ) {}

  get emailEnabled() {
    return this.email.enabled;
  }

  get smsProvider() {
    return this.sms.name;
  }

  /** True when a code can reach this destination without a staff member reading it. */
  canDeliverPrivately(dest: Destination) {
    return dest.kind === 'email' ? this.email.enabled : !this.sms.relayedByStaff;
  }

  /**
   * Make and send a code.
   * - `private`: staff must never see it (account recovery), so the owner-relay
   *   channel is refused.
   * - `onCooldown`: asking again within the cooldown either answers 429
   *   RESEND_COOLDOWN (`throw`, the default) or quietly sends nothing (`skip`,
   *   for answers that must look the same either way).
   * The relay channel keeps today's behaviour: asking again reuses the live code
   * the owner may already have sent.
   */
  async issue(
    user: { id: string; locale?: string | null },
    purpose: VerificationPurpose,
    dest: Destination,
    opts: { private?: boolean; onCooldown?: 'throw' | 'skip' } = {},
  ): Promise<IssueResult> {
    if (dest.kind === 'email' && !this.email.enabled) throw emailNotConfigured();
    const relay = dest.kind === 'phone' && this.sms.relayedByStaff;
    if (relay && opts.private) {
      throw new ConflictException({
        error: 'PRIVATE_CHANNEL_UNAVAILABLE',
        message: 'No automatic channel can deliver this code without staff seeing it',
      });
    }

    const now = Date.now();
    if (relay) {
      const live = await this.prisma.verificationToken.findFirst({
        where: { userId: user.id, purpose, consumedAt: null, codeEnc: { not: null }, expiresAt: { gt: new Date(now) } },
        orderBy: { createdAt: 'desc' },
      });
      if (live) return 'REUSED';
    } else {
      const cooldown = this.config.get<number>('security.resendCooldownSeconds') ?? 60;
      const recent = await this.prisma.verificationToken.findFirst({
        where: { userId: user.id, purpose, createdAt: { gt: new Date(now - cooldown * 1000) } },
        orderBy: { createdAt: 'desc' },
      });
      if (recent) {
        if (opts.onCooldown === 'skip') return 'COOLDOWN';
        const retryAfter = Math.max(1, Math.ceil((recent.createdAt.getTime() + cooldown * 1000 - now) / 1000));
        throw new HttpException(
          { error: 'RESEND_COOLDOWN', message: `Wait ${retryAfter}s before asking for another code`, retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const providerMakesCode = dest.kind === 'phone' && this.sms.providerChecksCode;
    const code = providerMakesCode ? null : this.crypto.randomNumericCode(6);
    const ttl = relay
      ? (this.config.get<number>('security.relayedOtpTtlSeconds') ?? 1800)
      : dest.kind === 'email'
        ? (this.config.get<number>('security.emailOtpTtlSeconds') ?? 900)
        : (this.config.get<number>('security.smsOtpTtlSeconds') ?? 600);

    // only one live code per purpose
    await this.prisma.verificationToken.updateMany({
      where: { userId: user.id, purpose, consumedAt: null },
      data: { consumedAt: new Date(now) },
    });
    const row = await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        purpose,
        codeHash: code ? this.crypto.sha256(code) : `${PROVIDER_PREFIX}${this.crypto.randomToken(16)}`,
        codeEnc: relay && code ? this.crypto.encrypt(code) : undefined,
        expiresAt: new Date(now + ttl * 1000),
      },
    });

    try {
      if (dest.kind === 'email') {
        await this.email.send({ to: dest.to, ...codeEmail(purpose, code as string, Math.round(ttl / 60), user.locale) });
      } else {
        await this.sms.send(dest.to, code, purpose);
      }
    } catch {
      // a code nobody received must not stay usable
      await this.prisma.verificationToken.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
      throw new BadGatewayException({
        error: dest.kind === 'email' ? 'EMAIL_SEND_FAILED' : 'SMS_SEND_FAILED',
        message: 'We could not send the code. Try again in a moment.',
      });
    }
    return 'SENT';
  }

  /**
   * Check and burn a code. Every guess counts before it is compared, so
   * parallel guesses cannot exceed the limit, and only one caller can consume it.
   */
  async consume(userId: string, purpose: VerificationPurpose, code: string, dest?: Destination) {
    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.expiresAt < new Date()) throw invalidCode();

    const max = this.config.get<number>('security.maxCodeAttempts') ?? 5;
    const bumped = await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { attempts: { increment: 1 } },
    });
    if ((bumped?.attempts ?? token.attempts + 1) > max) {
      await this.prisma.verificationToken.updateMany({ where: { id: token.id, consumedAt: null }, data: { consumedAt: new Date() } });
      throw new BadRequestException({ error: 'CODE_ATTEMPTS_EXCEEDED', message: 'Too many attempts — request a new code' });
    }

    let ok: boolean;
    if (token.codeHash.startsWith(PROVIDER_PREFIX)) {
      if (dest?.kind !== 'phone') throw invalidCode();
      try {
        ok = await this.sms.check(dest.to, code);
      } catch {
        throw new BadGatewayException({ error: 'SMS_CHECK_FAILED', message: 'We could not check the code. Try again in a moment.' });
      }
    } else {
      ok = this.crypto.timingSafeEquals(token.codeHash, this.crypto.sha256(code));
    }
    if (!ok) throw invalidCode();

    const { count } = await this.prisma.verificationToken.updateMany({
      where: { id: token.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count !== 1) throw invalidCode();
  }
}
