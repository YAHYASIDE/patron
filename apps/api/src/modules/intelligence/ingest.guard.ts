import { timingSafeEqual } from 'crypto';
import { ExecutionContext, ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthUser } from '../../common/decorators/current-user.decorator';

export const INGEST_TOKEN_HEADER = 'x-intel-token';
export const INGEST_PERMISSION = 'intelligence.decide';
/** A shorter configured token is treated as unset: it would be guessable. */
export const MIN_TOKEN_LENGTH = 16;

/** Who is ingesting, set on the request by the guard. */
export interface IngestActor {
  id?: string;
  label: string;
  via: 'token' | 'staff';
}

export type IngestRequest = { headers: Record<string, string | string[] | undefined>; user?: AuthUser; intelActor?: IngestActor };

/** Constant time, also when the lengths differ (the comparison still runs on equal-size buffers). */
export function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  const same = timingSafeEqual(a.length === b.length ? a : b, b);
  return a.length === b.length && same;
}

/**
 * POST /admin/intelligence/ingest is @Public() so that CI and outside agents
 * can post without a staff session; this guard does the check instead:
 *
 * - `x-intel-token` equal (constant time) to env INTEL_INGEST_TOKEN. With the
 *   env unset the token route is off: 403 INGEST_DISABLED. A wrong token: 401;
 * - otherwise a staff bearer token (the normal JWT strategy) whose user has
 *   `intelligence.decide` (super_admin bypasses, as everywhere).
 */
@Injectable()
export class IntelIngestGuard extends AuthGuard('jwt') {
  private readonly log = new Logger(IntelIngestGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IngestRequest>();
    const header = req.headers[INGEST_TOKEN_HEADER];
    const given = Array.isArray(header) ? header[0] : header;
    const auth = req.headers.authorization;
    const bearer = typeof auth === 'string' && /^bearer\s+\S+/i.test(auth);

    if (given || !bearer) {
      const expected = process.env.INTEL_INGEST_TOKEN?.trim() ?? '';
      if (expected.length < MIN_TOKEN_LENGTH) {
        if (expected) this.log.warn(`INTEL_INGEST_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters: token ingest stays off`);
        throw new ForbiddenException({ message: 'Agent ingest is not enabled on this server', error: 'INGEST_DISABLED' });
      }
      if (!given || !tokenMatches(given, expected)) {
        throw new UnauthorizedException({ message: 'Invalid ingest token', error: 'INVALID_INGEST_TOKEN' });
      }
      req.intelActor = { label: 'ingest-token', via: 'token' };
      return true;
    }

    // a staff session: the regular JWT strategy fills req.user (and throws 401 on a bad token)
    await super.canActivate(context);
    const user = req.user;
    if (!user) throw new UnauthorizedException();
    if (!user.roles.includes('super_admin') && !user.permissions.includes(INGEST_PERMISSION)) {
      throw new ForbiddenException(`Missing permission(s): ${INGEST_PERMISSION}`);
    }
    // the service replaces the label with the staff member's name
    req.intelActor = { id: user.id, label: user.id, via: 'staff' };
    return true;
  }
}
