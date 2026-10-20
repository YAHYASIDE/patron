import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from './token.service';
import { RequestMeta } from './auth.service';

const CHALLENGE_TTL_MS = 5 * 60_000;

const challengeExpired = () =>
  new BadRequestException({ error: 'PASSKEY_CHALLENGE_EXPIRED', message: 'This fingerprint/face request expired; try again' });
const passkeyRejected = () =>
  new UnauthorizedException({ error: 'PASSKEY_INVALID', message: 'This fingerprint/face sign-in was not accepted' });

/**
 * Sign in with the phone's fingerprint or face (WebAuthn passkeys).
 * Only public keys are stored; the biometric never leaves the phone. Login uses
 * discoverable credentials: the phone offers the passkeys it holds for this
 * site, so the customer types nothing. The relying party (RP id, origins) comes
 * from env: WEBAUTHN_RP_ID (default: STOREFRONT_URL's host) and STOREFRONT_URL.
 */
@Injectable()
export class PasskeysService {
  private readonly log = new Logger(PasskeysService.name);

  constructor(
    private prisma: PrismaService,
    private tokens: TokenService,
    private config: ConfigService,
  ) {}

  /** RP settings, or null when the store's address is not configured. */
  relyingParty(): { rpID: string; rpName: string; origins: string[] } | null {
    const origins = (this.config.get<string>('auth.webauthn.origins') ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean);
    let rpID = this.config.get<string>('auth.webauthn.rpId')?.trim();
    if (!rpID && origins[0]) {
      try {
        rpID = new URL(origins[0]).hostname;
      } catch {
        rpID = undefined;
      }
    }
    if (!rpID || origins.length === 0) return null;
    return { rpID, rpName: this.config.get<string>('auth.webauthn.rpName') ?? 'patron', origins };
  }

  private rp() {
    const rp = this.relyingParty();
    // 400, not 503: a missing setting is not an outage to page anyone about
    if (!rp) throw new BadRequestException({ error: 'PASSKEYS_NOT_CONFIGURED', message: 'Fingerprint/face sign-in is not available yet' });
    return rp;
  }

  // ─────────────── Register (signed in) ───────────────

  async registrationOptions(userId: string) {
    const rp = this.rp();
    const user = await this.prisma.user.findFirstOrThrow({
      where: { id: userId, deletedAt: null },
      select: { id: true, email: true, phone: true, fullName: true, passkeys: { select: { credentialId: true, transports: true } } },
    });
    const options = await generateRegistrationOptions({
      rpName: rp.rpName,
      rpID: rp.rpID,
      userName: user.phone ?? user.email ?? user.id,
      userDisplayName: user.fullName,
      userID: new Uint8Array(Buffer.from(user.id, 'utf8')),
      attestationType: 'none',
      excludeCredentials: user.passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports as AuthenticatorTransportFuture[],
      })),
      // the phone's own unlock (fingerprint/face), stored on the phone so login needs no name
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' },
    });
    const challenge = await this.prisma.webAuthnChallenge.create({
      data: { userId, purpose: 'register', challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { challengeId: challenge.id, options };
  }

  async verifyRegistration(userId: string, body: { challengeId: string; response: Record<string, unknown>; deviceName?: string }, meta: RequestMeta) {
    const rp = this.rp();
    const expectedChallenge = await this.takeChallenge(body.challengeId, 'register', userId);

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      this.log.warn(`passkey registration refused: ${e instanceof Error ? e.message : 'unknown'}`);
      throw new BadRequestException({ error: 'PASSKEY_INVALID', message: 'This fingerprint/face could not be added' });
    }
    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException({ error: 'PASSKEY_INVALID', message: 'This fingerprint/face could not be added' });
    }

    const { credential } = verification.registrationInfo;
    try {
      const created = await this.prisma.passkey.create({
        data: {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey),
          counter: BigInt(credential.counter),
          transports: credential.transports ?? [],
          deviceName: body.deviceName?.trim() || meta.deviceInfo || null,
        },
        select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
      });
      await this.audit(userId, 'auth.passkey_added', meta, created.id);
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'PASSKEY_EXISTS', message: 'This device is already added' });
      }
      throw e;
    }
  }

  // ─────────────── Login (public) ───────────────

  async authenticationOptions() {
    const rp = this.rp();
    // a cheap sweep keeps the table small: challenges live minutes
    await this.prisma.webAuthnChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', allowCredentials: [] });
    const challenge = await this.prisma.webAuthnChallenge.create({
      data: { purpose: 'login', challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
    });
    return { challengeId: challenge.id, options };
  }

  async verifyAuthentication(body: { challengeId: string; response: Record<string, unknown> }, meta: RequestMeta) {
    const rp = this.rp();
    const expectedChallenge = await this.takeChallenge(body.challengeId, 'login', null);
    const response = body.response as unknown as AuthenticationResponseJSON;
    if (typeof response?.id !== 'string') throw passkeyRejected();

    const passkey = await this.prisma.passkey.findUnique({ where: { credentialId: response.id }, include: { user: true } });
    if (!passkey) throw passkeyRejected();

    // a discoverable credential names its user; it must be the passkey's owner
    const handle = response.response?.userHandle;
    if (handle && Buffer.from(handle, 'base64url').toString('utf8') !== passkey.userId) throw passkeyRejected();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.rpID,
        credential: {
          id: passkey.credentialId,
          publicKey: new Uint8Array(passkey.publicKey),
          counter: Number(passkey.counter),
          transports: passkey.transports as AuthenticatorTransportFuture[],
        },
        requireUserVerification: true,
      });
    } catch (e) {
      this.log.warn(`passkey sign-in refused: ${e instanceof Error ? e.message : 'unknown'}`);
      throw passkeyRejected();
    }
    if (!verification.verified) throw passkeyRejected();

    const { user } = passkey;
    if (user.deletedAt) throw passkeyRejected();
    if (user.isBlocked) throw new ForbiddenException({ error: 'ACCOUNT_BLOCKED', message: 'This account has been blocked' });
    if (!user.isActive) throw new ForbiddenException({ error: 'ACCOUNT_INACTIVE', message: 'This account is inactive' });

    await this.prisma.passkey.update({
      where: { id: passkey.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), lastLoginIp: meta.ip } });
    await this.audit(user.id, 'auth.login_passkey', meta, passkey.id);
    return this.tokens.issue(user.id, user.email, { ip: meta.ip, deviceInfo: meta.deviceInfo, userAgent: meta.userAgent });
  }

  // ─────────────── My passkeys ───────────────

  list(userId: string) {
    return this.prisma.passkey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
    });
  }

  async remove(userId: string, id: string, meta: RequestMeta) {
    const { count } = await this.prisma.passkey.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException({ error: 'PASSKEY_NOT_FOUND', message: 'Passkey not found' });
    await this.audit(userId, 'auth.passkey_removed', meta, id);
    return { deleted: true };
  }

  /** Single use: the row is deleted as it is read, so a replay finds nothing. */
  private async takeChallenge(id: string, purpose: 'register' | 'login', userId: string | null) {
    const row = await this.prisma.webAuthnChallenge.findUnique({ where: { id } });
    if (!row || row.purpose !== purpose || row.userId !== userId) throw challengeExpired();
    const { count } = await this.prisma.webAuthnChallenge.deleteMany({ where: { id, expiresAt: { gt: new Date() } } });
    if (count !== 1) throw challengeExpired();
    return row.challenge;
  }

  private audit(userId: string, action: string, meta: RequestMeta, entityId: string) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Passkey', entityId, ipAddress: meta.ip, userAgent: meta.userAgent },
    });
  }
}
