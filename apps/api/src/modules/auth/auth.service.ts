import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User, VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { countryFromPhone } from '../../common/reference/phone-country';
import { TokenService, TokenPair } from './token.service';
import { CodesService, Destination, emailNotConfigured, invalidCode } from './codes.service';
import { LoginGuardService } from './login-guard.service';
import { accountWhere, parseIdentifier } from './identifier';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  PhoneLoginDto,
  PhoneStartDto,
  RegisterDto,
  RequestPhoneCodeDto,
  ResetPasswordDto,
  SetPasswordDto,
  VerifyCodeDto,
} from './dto/auth.dto';

export interface RequestMeta {
  ip: string;
  userAgent?: string;
  deviceInfo?: string;
}

export type PhoneStartResult = ({ status: 'SIGNED_IN' } & TokenPair) | { status: 'CODE_REQUIRED' };

const blocked = () => new ForbiddenException({ error: 'ACCOUNT_BLOCKED', message: 'This account has been blocked' });
const inactive = () => new ForbiddenException({ error: 'ACCOUNT_INACTIVE', message: 'This account is inactive' });

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private tokens: TokenService,
    private config: ConfigService,
    private codes: CodesService,
    private guard: LoginGuardService,
  ) {}

  private session(meta: RequestMeta) {
    return { ip: meta.ip, deviceInfo: meta.deviceInfo, userAgent: meta.userAgent };
  }

  // ─────────────── Register ───────────────

  async register(dto: RegisterDto, meta: RequestMeta): Promise<TokenPair> {
    const email = dto.email.toLowerCase().trim();
    const currency = dto.currency ?? this.config.get<string>('currency.base') ?? 'USD';

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, ...(dto.phone ? [{ phone: dto.phone }] : [])] },
    });
    if (existing) throw new BadRequestException({ error: 'ACCOUNT_EXISTS', message: 'An account with these details already exists' });

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

    // The account exists either way; a mail that cannot go now can be re-sent from the store.
    if (this.codes.emailEnabled) {
      await this.codes
        .issue(user, VerificationPurpose.EMAIL_VERIFY, { kind: 'email', to: email }, { onCooldown: 'skip' })
        .catch(() => this.logger.warn(`Email verification for ${user.id} could not be sent at sign-up`));
    }
    return this.tokens.issue(user.id, user.email, this.session(meta));
  }

  // ─────────────── Login (email or phone + password) ───────────────

  async login(dto: LoginDto, meta: RequestMeta): Promise<TokenPair> {
    const id = parseIdentifier(dto.identifier ?? dto.email);
    await this.guard.assertAllowed(id.to, meta.ip);

    const user = await this.prisma.user.findFirst({ where: accountWhere(id) });

    // Same failure path and timing whether the account exists or not —
    // otherwise login doubles as an account-enumeration oracle. The fake verify
    // runs the same Argon2 work as a real one.
    // A WhatsApp-number account without a password signs in by code only.
    const passwordOk = user?.passwordHash
      ? await this.crypto.verifyPassword(dto.password, user.passwordHash)
      : await this.crypto.fakeVerify(dto.password);

    if (!user || !passwordOk) {
      await this.guard.recordFailure(id.to, meta.ip, 'invalid_credentials');
      throw new UnauthorizedException({ error: 'INVALID_CREDENTIALS', message: 'Invalid email, phone or password' });
    }
    if (user.isBlocked) {
      await this.guard.recordFailure(id.to, meta.ip, 'blocked');
      throw blocked();
    }
    if (!user.isActive) {
      await this.guard.recordFailure(id.to, meta.ip, 'inactive');
      throw inactive();
    }

    await this.guard.recordSuccess(id.to, meta.ip);

    // Transparently upgrade a legacy bcrypt hash to Argon2id now that we hold
    // the plaintext — no password reset is forced by the migration.
    const rehashed = user.passwordHash && this.crypto.passwordNeedsRehash(user.passwordHash)
      ? await this.crypto.hashPassword(dto.password)
      : undefined;

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: meta.ip, ...(rehashed && { passwordHash: rehashed }) },
    });
    await this.auditAuth(user.id, id.kind === 'phone' ? 'auth.login_phone_password' : 'auth.login', meta);

    return this.tokens.issue(user.id, user.email, this.session(meta));
  }

  refresh(refreshToken: string, meta: RequestMeta) {
    return this.tokens.rotate(refreshToken, this.session(meta));
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

  // ─────────────── Sessions & devices ───────────────

  listSessions(userId: string, currentSessionId?: string) {
    return this.tokens.listSessions(userId, currentSessionId);
  }

  async revokeSession(userId: string, sessionId: string, meta: RequestMeta) {
    const res = await this.tokens.revokeSession(userId, sessionId);
    await this.auditAuth(userId, 'auth.session_revoked', meta, sessionId);
    return res;
  }

  async revokeOtherSessions(userId: string, currentSessionId: string | undefined, meta: RequestMeta) {
    const res = await this.tokens.revokeOtherSessions(userId, currentSessionId);
    await this.auditAuth(userId, 'auth.sessions_revoked_others', meta);
    return res;
  }

  /** A uniform auth audit row carrying the request's IP and user agent. */
  private auditAuth(userId: string, action: string, meta: RequestMeta, entityId = userId, entityType = entityId === userId ? 'User' : 'Session') {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType, entityId, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
  }

  // ─────────────── WhatsApp number sign-in ───────────────

  /**
   * A new number with a name signs straight in, unverified. A number that
   * already proves something (verified, has a password, or has orders) needs a
   * code (relayed by the owner over WhatsApp, or sent by the SMS provider), so
   * typing someone else's number never opens their account.
   */
  async phoneStart(dto: PhoneStartDto, meta: RequestMeta): Promise<PhoneStartResult> {
    await this.guard.assertAllowed(dto.phone, meta.ip);
    const user = await this.prisma.user.findFirst({
      where: { phone: dto.phone, deletedAt: null },
      include: { _count: { select: { orders: true } } },
    });

    if (!user) {
      if (!dto.fullName?.trim()) {
        throw new BadRequestException({ message: 'Enter your full name', error: 'NAME_REQUIRED' });
      }
      const created = await this.createPhoneCustomer(dto.phone, dto.fullName.trim(), dto.locale, meta);
      return { status: 'SIGNED_IN', ...(await this.tokens.issue(created.id, null, this.session(meta))) };
    }

    if (user.isBlocked) throw blocked();
    if (!user.isActive) throw inactive();

    const guarded = !!user.phoneVerifiedAt || !!user.passwordHash || user._count.orders > 0;
    if (guarded) {
      // asking again within the cooldown keeps the code already on its way
      await this.codes.issue(user, VerificationPurpose.PHONE_LOGIN, { kind: 'phone', to: dto.phone }, { onCooldown: 'skip' });
      return { status: 'CODE_REQUIRED' };
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: meta.ip } });
    await this.auditAuth(user.id, 'auth.login_phone', meta);
    return { status: 'SIGNED_IN', ...(await this.tokens.issue(user.id, user.email, this.session(meta))) };
  }

  /** Second step for a guarded number: the code that reached that WhatsApp/SMS. */
  async phoneLogin(dto: PhoneLoginDto, meta: RequestMeta): Promise<TokenPair> {
    await this.guard.assertAllowed(dto.phone, meta.ip);
    const user = await this.prisma.user.findFirst({ where: { phone: dto.phone, deletedAt: null } });
    try {
      if (!user) throw invalidCode();
      await this.codes.consume(user.id, VerificationPurpose.PHONE_LOGIN, dto.code, { kind: 'phone', to: dto.phone });
    } catch (err) {
      await this.guard.recordFailure(dto.phone, meta.ip, 'invalid_code');
      throw err;
    }
    if (user.isBlocked) throw blocked();
    if (!user.isActive) throw inactive();

    await this.guard.recordSuccess(dto.phone, meta.ip);
    // The code reached that number, which is exactly what verification proves.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(), lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });
    await this.auditAuth(user.id, 'auth.login_phone_code', meta);
    return this.tokens.issue(user.id, user.email, this.session(meta));
  }

  /** The signed-in customer asks for a code to verify their number (added here if they had none). */
  async requestPhoneCode(userId: string, dto: RequestPhoneCodeDto) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (user.phoneVerifiedAt) return { status: 'VERIFIED' as const, phone: user.phone };

    let phone = user.phone;
    if (!phone) {
      if (!dto.phone) throw new BadRequestException({ message: 'Add your WhatsApp number first', error: 'PHONE_REQUIRED' });
      const taken = await this.prisma.user.findFirst({ where: { phone: dto.phone, id: { not: userId } } });
      if (taken) throw new BadRequestException({ error: 'PHONE_TAKEN', message: 'That number belongs to another account' });
      phone = (
        await this.prisma.user.update({
          where: { id: userId },
          data: { phone: dto.phone, country: user.country ?? countryFromPhone(dto.phone) },
        })
      ).phone;
    }

    await this.codes.issue(user, VerificationPurpose.PHONE_VERIFY, { kind: 'phone', to: phone as string });
    return { status: 'SENT' as const, phone };
  }

  async verifyPhone(userId: string, dto: VerifyCodeDto) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    const dest: Destination | undefined = user.phone ? { kind: 'phone', to: user.phone } : undefined;
    await this.codes.consume(userId, VerificationPurpose.PHONE_VERIFY, dto.code, dest);
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
          country: countryFromPhone(phone),
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
        twoFaEnabled: true, createdAt: true, country: true, city: true, passwordHash: true,
        wallets: { select: { currencyCode: true, balance: true } },
        roles: { select: { role: { select: { name: true } } } },
        _count: { select: { passkeys: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const { roles, passwordHash, _count, ...rest } = user;
    return { ...rest, hasPassword: !!passwordHash, passkeyCount: _count.passkeys, roles: roles.map((r) => r.role.name) };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (!user.passwordHash) {
      throw new BadRequestException({ error: 'NO_PASSWORD', message: 'This account signs in with its WhatsApp number and has no password' });
    }
    if (!(await this.crypto.verifyPassword(dto.currentPassword, user.passwordHash))) {
      // 400, not 401: a client reads 401 on a signed-in call as "session over"
      throw new BadRequestException({ error: 'WRONG_PASSWORD', message: 'Current password is incorrect' });
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException({ error: 'SAME_PASSWORD', message: 'New password must differ from the current one' });
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

  /**
   * A WhatsApp-number customer adds a password, so they can sign in with
   * number + password when no code can reach them. Only once the number (or
   * email) is verified: otherwise whoever typed a stranger's number first could
   * lock a password onto it.
   */
  async setPassword(userId: string, dto: SetPasswordDto, meta: RequestMeta) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (user.passwordHash) {
      throw new BadRequestException({ error: 'PASSWORD_ALREADY_SET', message: 'This account already has a password; change it instead' });
    }
    if (!user.phoneVerifiedAt && !user.emailVerifiedAt) {
      throw new ForbiddenException({ error: 'VERIFY_FIRST', message: 'Verify your number before adding a password' });
    }
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, passwordHash: null },
      data: { passwordHash: await this.crypto.hashPassword(dto.newPassword) },
    });
    if (count !== 1) {
      throw new BadRequestException({ error: 'PASSWORD_ALREADY_SET', message: 'This account already has a password; change it instead' });
    }
    await this.auditAuth(userId, 'auth.password_set', meta);
    return { message: 'Password set' };
  }

  // ─────────────── Email verification ───────────────

  async verifyEmail(userId: string, dto: VerifyCodeDto) {
    await this.codes.consume(userId, VerificationPurpose.EMAIL_VERIFY, dto.code);
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
    await this.prisma.auditLog.create({
      data: { userId, action: 'auth.email_verified', entityType: 'User', entityId: userId },
    });
    return { message: 'Email verified' };
  }

  /** Send (again) the code that verifies the account's email; one per cooldown. */
  async resendEmailCode(userId: string) {
    const user = await this.prisma.user.findFirstOrThrow({ where: { id: userId, deletedAt: null } });
    if (user.emailVerifiedAt) return { status: 'VERIFIED' as const };
    if (!user.email) throw new BadRequestException({ error: 'EMAIL_REQUIRED', message: 'This account has no email' });
    await this.codes.issue(user, VerificationPurpose.EMAIL_VERIFY, { kind: 'email', to: user.email });
    return { status: 'SENT' as const };
  }

  // ─────────────── Password reset (email or phone) ───────────────

  /** Always the same answer — never reveals whether the email or number has an account. */
  async forgotPassword(dto: ForgotPasswordDto) {
    const id = parseIdentifier(dto.identifier ?? dto.email);
    // depends on the server's settings only, never on the account
    if (id.kind === 'email' && !this.codes.emailEnabled) throw emailNotConfigured();

    const user = await this.prisma.user.findFirst({ where: { ...accountWhere(id), isActive: true, isBlocked: false } });
    if (user) {
      await this.codes
        .issue(user, VerificationPurpose.PASSWORD_RESET, id, { onCooldown: 'skip' })
        .catch(() => this.logger.warn(`Password reset code for ${user.id} could not be sent`));
    }
    return { message: 'If that account exists, a reset code has been sent', channel: id.kind };
  }

  /** Only a proven code sets the password; the code also proves the contact, so it is marked verified. */
  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta) {
    const id = parseIdentifier(dto.identifier ?? dto.email);
    await this.guard.assertAllowed(id.to, meta.ip);
    const user = await this.prisma.user.findFirst({ where: accountWhere(id) });
    try {
      if (!user) throw invalidCode();
      await this.codes.consume(user.id, VerificationPurpose.PASSWORD_RESET, dto.code, id);
    } catch (err) {
      await this.guard.recordFailure(id.to, meta.ip, 'invalid_reset_code');
      throw err;
    }
    await this.guard.recordSuccess(id.to, meta.ip);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.crypto.hashPassword(dto.newPassword),
        ...this.verifiedNow(user, id),
      },
    });
    await this.tokens.revokeAllForUser(user.id);
    await this.auditAuth(user.id, 'auth.password_reset', meta);

    return { message: 'Password reset — please sign in' };
  }

  private verifiedNow(user: Pick<User, 'emailVerifiedAt' | 'phoneVerifiedAt'>, id: Destination) {
    return id.kind === 'email'
      ? { emailVerifiedAt: user.emailVerifiedAt ?? new Date() }
      : { phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() };
  }
}
