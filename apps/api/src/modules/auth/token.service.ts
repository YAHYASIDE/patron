import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { describeDevice } from './device';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionMeta {
  /** A label the client sent ("iPhone 15 · Safari"); else one is made from the user agent. */
  deviceInfo?: string;
  userAgent?: string;
  ip?: string;
  /** Kept across rotations; a new sign-in starts a new one. */
  sessionId?: string;
}

export interface SessionView {
  id: string;
  deviceInfo: string | null;
  ipAddress: string | null;
  signedInAt: Date;
  lastUsedAt: Date;
  current: boolean;
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
   * a database leak cannot be replayed as valid sessions. Each signed-in device
   * is one session (`sessionId`, carried in the access token as `sid`) that
   * keeps its id across rotations, so it can be listed and signed out.
   */
  async issue(userId: string, email: string | null, meta: SessionMeta = {}): Promise<TokenPair> {
    return (await this.issueRow(userId, email, meta)).pair;
  }

  private async issueRow(userId: string, email: string | null, meta: SessionMeta, db: Pick<PrismaService, 'refreshToken'> = this.prisma) {
    const sessionId = meta.sessionId ?? randomUUID();
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, type: 'access', sid: sessionId },
      { secret: this.config.getOrThrow('jwt.accessSecret'), expiresIn: this.config.get('jwt.accessTtl') },
    );

    const refreshToken = this.crypto.randomToken();
    const row = await db.refreshToken.create({
      data: {
        userId,
        sessionId,
        tokenHash: this.crypto.sha256(refreshToken),
        deviceInfo: (meta.deviceInfo?.trim() || describeDevice(meta.userAgent))?.slice(0, 120),
        ipAddress: meta.ip,
        lastUsedAt: new Date(),
        expiresAt: this.refreshExpiry(),
      },
    });

    return { row, pair: { accessToken, refreshToken, expiresIn: this.accessTtlSeconds() } };
  }

  /**
   * Rotation with reuse detection: presenting an already-rotated token
   * revokes every session, since it means the token was stolen. The old row is
   * revoked conditionally, so two parallel refreshes cannot both succeed, and
   * the new row commits in the same transaction (the session never looks dead).
   */
  async rotate(rawToken: string, meta: SessionMeta = {}): Promise<TokenPair> {
    const tokenHash = this.crypto.sha256(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) throw new UnauthorizedException('Invalid refresh token');

    if (stored.expiresAt < new Date()) throw new UnauthorizedException('Refresh token expired');
    if (!stored.user.isActive || stored.user.isBlocked || stored.user.deletedAt) {
      throw new UnauthorizedException('Account unavailable');
    }
    if (stored.revokedAt) {
      // signed out (this device, all devices, a password change): not theft, just over
      if (!stored.replacedBy) {
        throw new UnauthorizedException({ error: 'SESSION_ENDED', message: 'Session ended — sign in again' });
      }
      return this.reuseDetected(stored.userId);
    }

    const next = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) return null;
      const issued = await this.issueRow(stored.userId, stored.user.email, {
        ip: meta.ip ?? stored.ipAddress ?? undefined,
        // the device keeps its name; a fresh label only if it never had one
        deviceInfo: stored.deviceInfo ?? meta.deviceInfo,
        userAgent: meta.userAgent,
        sessionId: stored.sessionId ?? randomUUID(),
      }, tx);
      await tx.refreshToken.update({ where: { id: stored.id }, data: { replacedBy: issued.row.id } });
      return issued.pair;
    });
    // a parallel request rotated it between our read and our update: both
    // presented the live token at the same moment, so this is not a replay
    return next ?? this.reissueInSession(stored, meta);
  }

  private async reissueInSession(
    stored: { userId: string; sessionId: string | null; deviceInfo: string | null; ipAddress: string | null; user: { email: string | null } },
    meta: SessionMeta,
  ) {
    if (!stored.sessionId || !(await this.isSessionLive(stored.sessionId))) {
      throw new UnauthorizedException({ error: 'SESSION_ENDED', message: 'Session ended — sign in again' });
    }
    return this.issue(stored.userId, stored.user.email, {
      ip: meta.ip ?? stored.ipAddress ?? undefined,
      deviceInfo: stored.deviceInfo ?? meta.deviceInfo,
      userAgent: meta.userAgent,
      sessionId: stored.sessionId,
    });
  }

  private async reuseDetected(userId: string): Promise<never> {
    this.metrics.tokenReuseDetected.inc();
    await this.revokeAllForUser(userId);
    throw new UnauthorizedException('Refresh token reuse detected — all sessions revoked');
  }

  async revoke(rawToken: string) {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.crypto.sha256(rawToken) },
      select: { id: true, sessionId: true, userId: true },
    });
    if (!row) return;
    // signing out ends the whole device session, not just the newest token
    await this.prisma.refreshToken.updateMany({
      where: row.sessionId ? { userId: row.userId, sessionId: row.sessionId, revokedAt: null } : { id: row.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─────────────── Sessions & devices ───────────────

  /** The customer's signed-in devices, the one asking marked `current`. */
  async listSessions(userId: string, currentSessionId?: string): Promise<SessionView[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, sessionId: true, deviceInfo: true, ipAddress: true, createdAt: true, lastUsedAt: true },
    });
    const ids = rows.map((r) => r.sessionId).filter((s): s is string => !!s);
    const starts = ids.length
      ? await this.prisma.refreshToken.groupBy({
          by: ['sessionId'],
          where: { userId, sessionId: { in: ids } },
          _min: { createdAt: true },
        })
      : [];
    const startOf = new Map(starts.map((s) => [s.sessionId, s._min.createdAt]));

    const seen = new Set<string>();
    const out: SessionView[] = [];
    for (const r of rows) {
      const id = r.sessionId ?? r.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        deviceInfo: r.deviceInfo,
        ipAddress: r.ipAddress,
        signedInAt: (r.sessionId && startOf.get(r.sessionId)) || r.createdAt,
        lastUsedAt: r.lastUsedAt ?? r.createdAt,
        current: !!currentSessionId && id === currentSessionId,
      });
    }
    // the device in hand first
    return out.sort((a, b) => Number(b.current) - Number(a.current));
  }

  async revokeSession(userId: string, sessionId: string) {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, OR: [{ sessionId }, { id: sessionId, sessionId: null }] },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException({ error: 'SESSION_NOT_FOUND', message: 'Session not found' });
    return { revoked: true };
  }

  /** Sign out every device except the one asking. */
  async revokeOtherSessions(userId: string, currentSessionId?: string) {
    if (!currentSessionId) {
      throw new BadRequestException({ error: 'SESSION_UNKNOWN', message: 'Sign in again to manage your devices' });
    }
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, OR: [{ sessionId: null }, { sessionId: { not: currentSessionId } }] },
      data: { revokedAt: new Date() },
    });
    return { revoked: count };
  }

  /** Whether a session still has a live refresh token (checked on every authenticated request). */
  async isSessionLive(sessionId: string) {
    const live = await this.prisma.refreshToken.findFirst({
      where: { sessionId, revokedAt: null },
      select: { id: true },
    });
    return !!live;
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
