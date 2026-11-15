import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Brute-force protection that cannot be turned against the account's owner.
 *
 * Failures are counted per (identifier, IP) and per IP — never per account
 * alone. A stranger hammering the owner's number from their own connection
 * locks only that (number, stranger's IP) pair and, past a higher bar, the
 * stranger's IP; the owner signing in from their own device is unaffected.
 *
 * - progressive delay: from the 2nd failure of a pair, the next try must wait
 *   2s, 4s, 8s… (capped), so guessing is slow long before the lock;
 * - pair lock: `maxLoginAttempts` failures in `lockoutMinutes` lock the pair
 *   until they age out; a success clears the pair's count;
 * - IP lock: `maxIpFailures` failures from one IP, whatever the identifier,
 *   lock that IP (a stranger spraying many accounts);
 * - and the route throttler still caps raw request rates per IP.
 */
@Injectable()
export class LoginGuardService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  private settings() {
    return {
      maxPair: this.config.get<number>('security.maxLoginAttempts') ?? 5,
      maxIp: this.config.get<number>('security.maxIpFailures') ?? 30,
      windowMs: (this.config.get<number>('security.lockoutMinutes') ?? 15) * 60_000,
      maxDelayS: 30,
    };
  }

  /** Seconds to wait after `failures` consecutive failures of a pair (0 = none). */
  static delayFor(failures: number, maxDelayS = 30) {
    return failures < 2 ? 0 : Math.min(2 ** (failures - 1), maxDelayS);
  }

  /** Throws TOO_MANY_ATTEMPTS (403, with retryAfter seconds) when this pair or IP must wait. */
  async assertAllowed(identifier: string, ip: string) {
    const { maxPair, maxIp, windowMs, maxDelayS } = this.settings();
    const now = Date.now();
    const since = new Date(now - windowMs);

    const [lastOk, ipFailures] = await Promise.all([
      this.prisma.loginAttempt.findFirst({
        where: { identifier, ipAddress: ip, success: true, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.prisma.loginAttempt.count({ where: { ipAddress: ip, success: false, createdAt: { gte: since } } }),
    ]);

    if (ipFailures >= maxIp) throw this.tooMany(Math.ceil(windowMs / 1000), windowMs);

    const failures = await this.prisma.loginAttempt.findMany({
      where: { identifier, ipAddress: ip, success: false, createdAt: { gt: lastOk?.createdAt ?? since } },
      orderBy: { createdAt: 'desc' },
      take: maxPair,
      select: { createdAt: true },
    });

    if (failures.length >= maxPair) {
      // locked until the oldest of the last `maxPair` failures leaves the window
      const oldest = failures[failures.length - 1].createdAt.getTime();
      throw this.tooMany(Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)), windowMs);
    }

    const wait = LoginGuardService.delayFor(failures.length, maxDelayS);
    if (wait > 0) {
      const ready = failures[0].createdAt.getTime() + wait * 1000;
      if (ready > now) throw this.tooMany(Math.ceil((ready - now) / 1000), windowMs);
    }
  }

  recordFailure(identifier: string, ip: string, reason: string) {
    return this.prisma.loginAttempt.create({ data: { identifier, ipAddress: ip, success: false, reason } });
  }

  recordSuccess(identifier: string, ip: string) {
    return this.prisma.loginAttempt.create({ data: { identifier, ipAddress: ip, success: true } });
  }

  private tooMany(retryAfter: number, windowMs: number) {
    const minutes = Math.max(1, Math.ceil(Math.min(retryAfter * 1000, windowMs) / 60_000));
    return new ForbiddenException({
      error: 'TOO_MANY_ATTEMPTS',
      message: retryAfter < 60
        ? `Too many failed attempts. Try again in ${retryAfter} seconds.`
        : `Too many failed attempts. Try again in ${minutes} minutes.`,
      retryAfter,
    });
  }
}
