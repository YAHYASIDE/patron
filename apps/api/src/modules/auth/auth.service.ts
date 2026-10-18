import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { TokenService, TokenPair } from './token.service';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  PhoneLoginDto,
  PhoneStartDto,
  RegisterDto,
  RequestPhoneCodeDto,
  ResetPasswordDto,
  VerifyCodeDto,
} from './dto/auth.dto';

interface RequestMeta {
  ip: string;
  userAgent?: string;
  deviceInfo?: string;
}

export type PhoneStartResult = ({ status: 'SIGNED_IN' } & TokenPair) | { status: 'CODE_REQUIRED' };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private tokens: TokenService,
    private config: ConfigService,
  ) {}

  // ─────────────── Register ───────────────

  async register(dto: RegisterDto, meta: RequestMeta): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    const currency = dto.currency ?? this.config.get<string>('currency.base') ?? 'USD';

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, ...(dto.phone ? [{ phone: dto.phone }] : [])] },
    });
    if (existing) throw new BadRequestException('An account with these details already exists');

    const customerRole = await this.prisma.role.findUnique({ where: { name: 'customer' } });
    if (!customerRole) throw new BadRequestException('Customer role missing — run the seed');

    // User, role assignment and the default wallet must all exist or none do.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone: dto.phone,
          fullName: dto.fullName.trim(),
          passwordHash: await this.crypto.hashPassword(dto.password),
          defaultCurrency: currency,
          locale: dto.locale ?? 'ar',
          roles: { create: { roleId: customerRole.id } },
          wallets: { create: { currencyCode: currency } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: created.id,
          action: 'auth.register',
          entityType: 'User',
          entityId: created.id,
          ipAddress: meta.ip,
          userAgent: meta.userAgent,
        },
      });
      return created;
    });

    await this.issueVerificationCode(user.id, VerificationPurpose.EMAIL_VERIFY);
    return this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  // ─────────────── Login ───────────────

  async login(dto: LoginDto, meta: RequestMeta): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    await this.assertNotLockedOut(email, meta.ip);

    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });

    // Same failure path and timing whether the email exists or not —
    // otherwise login doubles as an account-enumeration oracle. The fake verify
    // runs the same Argon2 work as a real one.
    // A WhatsApp-number account has no password: it signs in by code only.
    const passwordOk = user?.passwordHash
      ? await this.crypto.verifyPassword(dto.password, user.passwordHash)
      : await this.crypto.fakeVerify(dto.password);

    if (!user || !passwordOk) {
      await this.recordAttempt(email, meta.ip, false, 'invalid_credentials');
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.isBlocked) {
      await this.recordAttempt(email, meta.ip, false, 'blocked');
      throw new ForbiddenException('This account has been blocked');
    }
    if (!user.isActive) {
      await this.recordAttempt(email, meta.ip, false, 'inactive');
      throw new ForbiddenException('This account is inactive');
    }

    await this.recordAttempt(email, meta.ip, true);

    // Transparently upgrade a legacy bcrypt hash to Argon2id now that we hold
    // the plaintext — no password reset is forced by the migration.
    const rehashed = user.passwordHash && this.crypto.passwordNeedsRehash(user.passwordHash)
      ? await this.crypto.hashPassword(dto.password)
      : undefined;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: meta.ip, ...(rehashed && { passwordHash: rehashed }) },
    });
    await this.auditAuth(user.id, 'auth.login', meta);

    return this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  refresh(refreshToken: string, meta: RequestMeta) {
    return this.tokens.rotate(refreshToken, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  async logout(refreshToken: string, meta: RequestMeta) {
    // Resolve the owner before revoking so the audit entry names the user.
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(refreshToken) },
      select: { userId: true },
    });
    await this.tokens.revoke(refreshToken);
    if (stored) await this.auditAuth(stored.userId, 'auth.logout', meta);
    return { message: 'Logged out' };
  }

  async logoutAll(userId: string, meta: RequestMeta) {
    await this.tokens.revokeAllForUser(userId);
    await this.auditAuth(userId, 'auth.logout_all', meta);
    return { message: 'All sessions revoked' };
  }

  /** A uniform auth audit row carrying the request's IP and user agent. */
  private auditAuth(userId: string, action: string, meta: RequestMeta) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'User', entityId: userId, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
  }

  // ─────────────── WhatsApp number sign-in ───────────────

  /**
   * A new number with a name signs straight in, unverified. A number that
   * already proves something (verified, has a password, or has orders) needs a
   * code the owner relays over WhatsApp, so typing someone else's number never
   * opens their account.
   */
  async phoneStart(dto: PhoneStartDto, meta: RequestMeta): Promise<PhoneStartResult> {
    await this.assertNotLockedOut(dto.phone, meta.ip);
    const user = await this.prisma.user.findFirst({
      where: { phone: dto.phone, deletedAt: null },
      include: { _count: { select: { orders: true } } },
    });

    if (!user) {
      if (!dto.fullName?.trim()) {
        throw new BadRequestException({ message: 'Enter your full name', error: 'NAME_REQUIRED' });
      }
      const created = await this.createPhoneCustomer(dto.phone, dto.fullName.trim(), dto.locale, meta);
      return { status: 'SIGNED_IN', ...(await this.tokens.issue(created.id, null, { ip: meta.ip, deviceInfo: meta.deviceInfo })) };
    }

    if (user.isBlocked) throw new ForbiddenException('This account has been blocked');
    if (!user.isActive) throw new ForbiddenException('This account is inactive');

    const guarded = !!user.phoneVerifiedAt || !!user.passwordHash || user._count.orders > 0;
    if (guarded) {
      await this.issueVerificationCode(user.id, VerificationPurpose.PHONE_LOGIN, { relay: true });
      return { status: 'CODE_REQUIRED' };
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: meta.ip } });
    await this.auditAuth(user.id, 'auth.login_phone', meta);
    return { status: 'SIGNED_IN', ...(await this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo })) };
  }

  /** Second step for a guarded number: the code the owner sent over WhatsApp. */
  async phoneLogin(dto: PhoneLoginDto, meta: RequestMeta): Promise<TokenPair> {
    await this.assertNotLockedOut(dto.phone, meta.ip);
    const user = await this.prisma.user.findFirst({ where: { phone: dto.phone, deletedAt: null } });
    try {
      if (!user) throw new BadRequestException('Invalid or expired code');
      await this.consumeCode(user.id, VerificationPurpose.PHONE_LOGIN, dto.code);
    } catch (err) {
      await this.recordAttempt(dto.phone, meta.ip, false, 'invalid_code');
      throw err;
    }
    if (user.isBlocked) throw new ForbiddenException('This account has been blocked');
    if (!user.isActive) throw new ForbiddenException('This account is inactive');

    await this.recordAttempt(dto.phone, meta.ip, true);
    // The code reached that WhatsApp, which is exactly what verification proves.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(), lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });
    await this.auditAuth(user.id, 'auth.login_phone_code', meta);
    return this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  /** The signed-in customer asks for a code to verify their number (added here if they had none). */
  async requestPhoneCode(userId: string, dto: RequestPhoneCodeDto) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (user.phoneVerifiedAt) return { status: 'VERIFIED' as const, phone: user.phone };

    let phone = user.phone;
    if (!phone) {
      if (!dto.phone) throw new BadRequestException({ message: 'Add your WhatsApp number first', error: 'PHONE_REQUIRED' });
      const taken = await this.prisma.user.findFirst({ where: { phone: dto.phone, id: { not: userId } } });
      if (taken) throw new BadRequestException('That number belongs to another account');
      phone = (await this.prisma.user.update({ where: { id: userId }, data: { phone: dto.phone } })).phone;
    }

    await this.issueVerificationCode(userId, VerificationPurpose.PHONE_VERIFY, { relay: true });
    return { status: 'SENT' as const, phone };
  }

  async verifyPhone(userId: string, dto: VerifyCodeDto) {
    await this.consumeCode(userId, VerificationPurpose.PHONE_VERIFY, dto.code);
    await this.prisma.user.update({ where: { id: userId }, data: { phoneVerifiedAt: new Date() } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'auth.phone_verified', entityType: 'User', entityId: userId },
    });
    return { message: 'Phone verified' };
  }

  private async createPhoneCustomer(phone: string, fullName: string, locale: string | undefined, meta: RequestMeta) {
    const customerRole = await this.prisma.role.findUnique({ where: { name: 'customer' } });
    if (!customerRole) throw new BadRequestException('Customer role missing — run the seed');
    const currency = this.config.get<string>('currency.base') ?? 'USD';

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          phone,
          fullName,
          locale: locale ?? 'ar',
          defaultCurrency: currency,
          lastLoginAt: new Date(),
          lastLoginIp: meta.ip,
          roles: { create: { roleId: customerRole.id } },
          wallets: { create: { currencyCode: currency } },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: created.id, action: 'auth.register_phone', entityType: 'User', entityId: created.id,
          ipAddress: meta.ip, userAgent: meta.userAgent,
        },
      });
      return created;
    });
  }

  // ─────────────── Codes the owner relays over WhatsApp ───────────────

  /** Live codes waiting for the owner to send, oldest first, readable by them. */
  async listRelayPending() {
    const rows = await this.prisma.verificationToken.findMany({
      where: { codeEnc: { not: null }, consumedAt: null, expiresAt: { gt: new Date() }, user: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, purpose: true, codeEnc: true, createdAt: true, expiresAt: true, sentAt: true,
        user: { select: { id: true, fullName: true, phone: true, phoneVerifiedAt: true } },
      },
    });
    return rows.map(({ codeEnc, ...r }) => ({ ...r, code: this.crypto.decrypt(codeEnc as string) }));
  }

  async markRelaySent(id: string, actorId: string) {
    const { count } = await this.prisma.verificationToken.updateMany({
      where: { id, codeEnc: { not: null }, consumedAt: null },
      data: { sentAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Code not found or already used');
    // the code itself never goes into the audit log
    await this.prisma.auditLog.create({
      data: { userId: actorId, action: 'auth.code_relayed', entityType: 'VerificationToken', entityId: id },
    });
    return { sent: true };
  }

  // ─────────────── Profile & password ───────────────

  async me(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true, email: true, phone: true, fullName: true, avatarUrl: true,
        locale: true, defaultCurrency: true, emailVerifiedAt: true, phoneVerifiedAt: true,
        twoFaEnabled: true, createdAt: true,
        wallets: { select: { currencyCode: true, balance: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const { roles, ...rest } = user;
    return { ...rest, roles: roles.map((r) => r.role.name) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (!user.passwordHash) throw new BadRequestException('This account signs in with its WhatsApp number and has no password');
    if (!(await this.crypto.verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must differ from the current one');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.crypto.hashPassword(dto.newPassword) },
    });
    // A password change invalidates every existing session.
    await this.tokens.revokeAllForUser(userId);
    await this.prisma.auditLog.create({
      data: { userId, action: 'auth.password_change', entityType: 'User', entityId: userId },
    });

    return { message: 'Password changed — please sign in again' };
  }

  // ─────────────── Verification codes ───────────────

  /**
   * `relay`: the owner sends this code by hand, so it is kept readable
   * (encrypted) for them, lives longer, and asking again reuses the live code
   * instead of replacing the one they may already have sent.
   */
  async issueVerificationCode(userId: string, purpose: VerificationPurpose, opts: { relay?: boolean } = {}) {
    if (opts.relay) {
      const live = await this.prisma.verificationToken.findFirst({
        where: { userId, purpose, consumedAt: null, codeEnc: { not: null }, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });
      if (live?.codeEnc) return this.crypto.decrypt(live.codeEnc);
    }

    const code = this.crypto.randomNumericCode(6);
    const ttl = opts.relay
      ? (this.config.get<number>('security.relayedOtpTtlSeconds') ?? 1800)
      : (this.config.get<number>('security.otpTtlSeconds') ?? 300);

    // Only one live code per purpose.
    await this.prisma.verificationToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await this.prisma.verificationToken.create({
      data: {
        userId,
        purpose,
        codeHash: this.crypto.sha256(code),
        codeEnc: opts.relay ? this.crypto.encrypt(code) : undefined,
        expiresAt: new Date(Date.now() + ttl * 1000),
      },
    });

    // TODO(notifications): hand off to the email/SMS channel once that module lands.
    this.logger.debug(`Verification code for ${userId} (${purpose}): ${code}`);
    return code;
  }

  async verifyEmail(userId: string, dto: VerifyCodeDto) {
    await this.consumeCode(userId, VerificationPurpose.EMAIL_VERIFY, dto.code);
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    return { message: 'Email verified' };
  }

  /** Always returns the same response — never reveals whether the email exists. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), deletedAt: null, isActive: true },
    });
    if (user) await this.issueVerificationCode(user.id, VerificationPurpose.PASSWORD_RESET);
    return { message: 'If that email is registered, a reset code has been sent' };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email.toLowerCase().trim(), deletedAt: null },
    });
    if (!user) throw new BadRequestException('Invalid or expired code');

    await this.consumeCode(user.id, VerificationPurpose.PASSWORD_RESET, dto.code);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.crypto.hashPassword(dto.newPassword) },
    });
    await this.tokens.revokeAllForUser(user.id);
    await this.prisma.auditLog.create({
      data: { userId: user.id, action: 'auth.password_reset', entityType: 'User', entityId: user.id },
    });

    return { message: 'Password reset — please sign in' };
  }

  private async consumeCode(userId: string, purpose: VerificationPurpose, code: string) {
    const token = await this.prisma.verificationToken.findFirst({
      where: { userId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.expiresAt < new Date()) throw new BadRequestException('Invalid or expired code');

    if (token.attempts >= 5) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { consumedAt: new Date() },
      });
      throw new BadRequestException('Too many attempts — request a new code');
    }
    if (!this.crypto.timingSafeEquals(token.codeHash, this.crypto.sha256(code))) {
      await this.prisma.verificationToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException('Invalid or expired code');
    }

    await this.prisma.verificationToken.update({
      where: { id: token.id },
      data: { consumedAt: new Date() },
    });
  }

  // ─────────────── Brute-force protection ───────────────

  private async assertNotLockedOut(identifier: string, ip: string) {
    const max = this.config.get<number>('security.maxLoginAttempts') ?? 5;
    const minutes = this.config.get<number>('security.lockoutMinutes') ?? 15;
    const since = new Date(Date.now() - minutes * 60_000);

    const failures = await this.prisma.loginAttempt.count({
      where: { success: false, createdAt: { gte: since }, OR: [{ identifier }, { ipAddress: ip }] },
    });
    if (failures >= max) {
      throw new ForbiddenException(`Too many failed attempts. Try again in ${minutes} minutes.`);
    }
  }

  private recordAttempt(identifier: string, ipAddress: string, success: boolean, reason?: string) {
    return this.prisma.loginAttempt.create({ data: { identifier, ipAddress, success, reason } });
  }
}
