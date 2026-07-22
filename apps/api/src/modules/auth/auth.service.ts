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
  RegisterDto,
  ResetPasswordDto,
  VerifyCodeDto,
} from './dto/auth.dto';

interface RequestMeta {
  ip: string;
  userAgent?: string;
  deviceInfo?: string;
}

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
    // otherwise login doubles as an account-enumeration oracle.
    const passwordOk = user
      ? await this.crypto.verifyPassword(dto.password, user.passwordHash)
      : await this.crypto.verifyPassword(dto.password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');

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
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), lastLoginIp: meta.ip },
    });

    return this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  refresh(refreshToken: string, meta: RequestMeta) {
    return this.tokens.rotate(refreshToken, { ip: meta.ip, deviceInfo: meta.deviceInfo });
  }

  async logout(refreshToken: string) {
    await this.tokens.revoke(refreshToken);
    return { message: 'Logged out' };
  }

  async logoutAll(userId: string) {
    await this.tokens.revokeAllForUser(userId);
    return { message: 'All sessions revoked' };
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

  async issueVerificationCode(userId: string, purpose: VerificationPurpose) {
    const code = this.crypto.randomNumericCode(6);
    const ttl = this.config.get<number>('security.otpTtlSeconds') ?? 300;

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
