import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MetricsService } from '../../common/metrics/metrics.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class TokenService {
  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
    private crypto: CryptoService,
    private metrics: MetricsService,
  ) {}

  /**
   * Refresh tokens are opaque random strings stored as SHA-256 digests —
   * a database leak cannot be replayed as valid sessions.
   */
  async issue(userId: string, email: string, meta: { deviceInfo?: string; ip?: string } = {}): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'access' },
      { secret: this.config.getOrThrow('jwt.accessSecret'), expiresIn: this.config.get('jwt.accessTtl') },
    );

    const refreshToken = this.crypto.randomToken();
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.crypto.sha256(refreshToken),
        deviceInfo: meta.deviceInfo,
        ipAddress: meta.ip,
        expiresAt: this.refreshExpiry(),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() };
  }

  /**
   * Rotation with reuse detection: presenting an already-rotated token
   * revokes the entire family, since it means the token was stolen.
   */
  async rotate(rawToken: string, meta: { deviceInfo?: string; ip?: string } = {}): Promise<TokenPair> {
    const tokenHash = this.crypto.sha256(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.revokedAt) {
      this.metrics.tokenReuseDetected.inc();
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    if (!stored.user.isActive || stored.user.isBlocked || stored.user.deletedAt) {
      throw new UnauthorizedException('Account unavailable');
    }

    const next = await this.issue(stored.userId, stored.user.email, meta);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return next;
  }

  async revoke(rawToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.crypto.sha256(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private accessTtlSeconds(): number {
    const ttl = this.config.get<string>('jwt.accessTtl') ?? '15m';
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 900;
    const mult = { s: 1, m: 60, h: 3600, d: 86400 }[match[2] as 's' | 'm' | 'h' | 'd'];
    return parseInt(match[1], 10) * mult;
  }

  private refreshExpiry(): Date {
    const ttl = this.config.get<string>('jwt.refreshTtl') ?? '30d';
    const match = /^(\d+)([smhd])$/.exec(ttl);
    const days = match && match[2] === 'd' ? parseInt(match[1], 10) : 30;
    return new Date(Date.now() + days * 86_400_000);
  }
}
