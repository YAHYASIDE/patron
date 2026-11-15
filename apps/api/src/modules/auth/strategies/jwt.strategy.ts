import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: string;
  email: string;
  type: 'access';
  /** The device session (kept across refreshes); absent on tokens issued before sessions existed. */
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('jwt.accessSecret'),
    });
  }

  /**
   * Roles and permissions are resolved per request rather than embedded in the
   * token. A revoked permission takes effect immediately instead of lingering
   * until the access token expires.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    if (payload.type !== 'access') throw new UnauthorizedException('Wrong token type');

    // A device signed out from the sessions page loses access at once, not
    // when its access token runs out.
    if (payload.sid) {
      const live = await this.prisma.refreshToken.findFirst({
        where: { sessionId: payload.sid, userId: payload.sub, revokedAt: null },
        select: { id: true },
      });
      if (!live) throw new UnauthorizedException('Session ended');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null, isActive: true, isBlocked: false },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
    if (!user) throw new UnauthorizedException('Account unavailable');

    const roles = user.roles.map((r) => r.role.name);
    const permissions = [
      ...new Set(user.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.key))),
    ];

    return { id: user.id, email: user.email, phone: user.phone, roles, permissions, ...(payload.sid && { sessionId: payload.sid }) };
  }
}
