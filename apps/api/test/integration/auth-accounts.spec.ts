import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { TokenService } from '../../src/modules/auth/token.service';
import { CodesService } from '../../src/modules/auth/codes.service';
import { LoginGuardService } from '../../src/modules/auth/login-guard.service';
import { RecoveryService } from '../../src/modules/auth/recovery.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { CaptureSmsSender } from '../../src/modules/auth/senders/sms-sender';
import { CaptureEmailSender } from '../../src/modules/auth/senders/email-sender';
import { captureOutbox } from '../../src/modules/auth/senders/capture-outbox';

/**
 * Accounts against a real Postgres: the lockout that cannot be turned against
 * the owner, single-use codes under concurrency, device sessions across
 * rotation and sign-out, and a full support-assisted recovery.
 */
describe('Accounts & sign-in (integration)', () => {
  let prisma: PrismaService;
  let crypto: CryptoService;
  let tokens: TokenService;
  let codes: CodesService;
  let auth: AuthService;
  let recovery: RecoveryService;
  let strategy: JwtStrategy;
  let jwt: JwtService;
  const password = `Pw${randomUUID().slice(0, 8)}A1z`;
  const OWNER_IP = '41.188.1.10';
  const STRANGER_IP = '102.33.4.5';
  const phone = () => `+2224${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;

  beforeAll(async () => {
    const values: Record<string, unknown> = {
      'crypto.encryptionKey': process.env.ENCRYPTION_KEY,
      'jwt.accessSecret': process.env.JWT_ACCESS_SECRET,
      'jwt.accessTtl': '15m',
      'jwt.refreshTtl': '30d',
      'currency.base': 'USD',
    };
    const config = {
      get: (k: string) => values[k],
      getOrThrow: (k: string) => values[k],
    } as unknown as ConfigService;

    prisma = new PrismaService();
    await prisma.$connect();
    crypto = new CryptoService(config);
    jwt = new JwtService({});
    tokens = new TokenService(jwt, config, prisma, crypto, { tokenReuseDetected: { inc: () => undefined } } as never);
    codes = new CodesService(prisma, crypto, config, new CaptureSmsSender(), new CaptureEmailSender());
    const guard = new LoginGuardService(prisma, config);
    auth = new AuthService(prisma, crypto, tokens, config, codes, guard);
    recovery = new RecoveryService(prisma, crypto, codes, guard, tokens, new StaffNotificationsService(prisma));
    strategy = new JwtStrategy(config, prisma);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    captureOutbox.clear();
    await prisma.role.upsert({ where: { name: 'customer' }, update: {}, create: { name: 'customer', isSystem: true } });
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
  });

  /** A WhatsApp customer whose number is verified and who added a password. */
  async function ownerWithPassword() {
    const number = phone();
    const user = await prisma.user.create({
      data: { phone: number, fullName: 'Owner', phoneVerifiedAt: new Date(), passwordHash: await crypto.hashPassword(password) },
    });
    return { user, number };
  }

  const sidOf = (accessToken: string) => (jwt.decode(accessToken) as { sid: string }).sid;

  describe('brute force (audit M2)', () => {
    it('a stranger hammering the owner\'s number is stopped, the owner still signs in from their device', async () => {
      const { number } = await ownerWithPassword();

      const stranger = () => auth.login({ identifier: number, password: 'WrongPass123' }, { ip: STRANGER_IP });
      await expect(stranger()).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
      await expect(stranger()).rejects.toMatchObject({ response: { error: 'INVALID_CREDENTIALS' } });
      // the progressive delay kicks in at once
      await expect(stranger()).rejects.toMatchObject({ response: { error: 'TOO_MANY_ATTEMPTS' } });

      // …and five failures within the window lock that pair, even for the right password
      await prisma.loginAttempt.createMany({
        data: Array.from({ length: 3 }, (_, i) => ({
          identifier: number, ipAddress: STRANGER_IP, success: false, createdAt: new Date(Date.now() - (i + 1) * 60_000),
        })),
      });
      await expect(auth.login({ identifier: number, password }, { ip: STRANGER_IP })).rejects.toMatchObject({
        response: { error: 'TOO_MANY_ATTEMPTS' },
      });

      // the owner, from their own phone, is not locked out
      const pair = await auth.login({ identifier: number, password }, { ip: OWNER_IP, userAgent: 'iPhone Safari/1' });
      expect(pair.accessToken).toBeDefined();
    });

    it('one IP failing on many accounts is locked everywhere, other IPs are not', async () => {
      await prisma.loginAttempt.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({ identifier: `x${i}@spray.test`, ipAddress: STRANGER_IP, success: false })),
      });
      const { number } = await ownerWithPassword();
      await expect(auth.login({ identifier: number, password }, { ip: STRANGER_IP })).rejects.toMatchObject({
        response: { error: 'TOO_MANY_ATTEMPTS' },
      });
      await expect(auth.login({ identifier: number, password }, { ip: OWNER_IP })).resolves.toHaveProperty('accessToken');
    });
  });

  describe('codes', () => {
    it('a code works once, even when two requests race with it', async () => {
      const { user, number } = await ownerWithPassword();
      await codes.issue(user, 'PASSWORD_RESET', { kind: 'phone', to: number });
      const code = captureOutbox.lastCode(number) as string;

      const results = await Promise.allSettled([
        codes.consume(user.id, 'PASSWORD_RESET', code),
        codes.consume(user.id, 'PASSWORD_RESET', code),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id } });
      expect(row.codeHash).not.toContain(code);
      expect(row.codeEnc).toBeNull();
    });

    it('reset by phone: proven code → new password works, old sessions end', async () => {
      const { number } = await ownerWithPassword();
      const before = await auth.login({ identifier: number, password }, { ip: OWNER_IP });

      await auth.forgotPassword({ identifier: number });
      const code = captureOutbox.lastCode(number) as string;
      const fresh = `Nw${randomUUID().slice(0, 8)}B2y`;
      await auth.resetPassword({ identifier: number, code, newPassword: fresh }, { ip: OWNER_IP });

      await expect(tokens.rotate(before.refreshToken)).rejects.toMatchObject({ response: { error: 'SESSION_ENDED' } });
      await expect(auth.login({ identifier: number, password }, { ip: OWNER_IP })).rejects.toBeDefined();
      await expect(auth.login({ identifier: number, password: fresh }, { ip: '8.8.8.8' })).resolves.toHaveProperty('accessToken');
    });
  });

  describe('device sessions', () => {
    it('lists devices, keeps the session across refreshes, and signs out the others at once', async () => {
      const { user, number } = await ownerWithPassword();
      const phoneSession = await auth.login({ identifier: number, password }, { ip: OWNER_IP, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1' });
      const laptop = await auth.login({ identifier: number, password }, { ip: '8.8.4.4', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Safari/537.36' });

      const rotated = await tokens.rotate(phoneSession.refreshToken, { ip: OWNER_IP });
      expect(sidOf(rotated.accessToken)).toBe(sidOf(phoneSession.accessToken));

      const list = await auth.listSessions(user.id, sidOf(rotated.accessToken));
      expect(list).toHaveLength(2);
      expect(list[0]).toMatchObject({ current: true, deviceInfo: 'iPhone · Safari', ipAddress: OWNER_IP });
      expect(list[1]).toMatchObject({ current: false, deviceInfo: 'Windows · Chrome' });

      await auth.revokeOtherSessions(user.id, sidOf(rotated.accessToken), { ip: OWNER_IP });

      // the laptop's refresh token is over, and its still-unexpired access token is refused now
      await expect(tokens.rotate(laptop.refreshToken)).rejects.toMatchObject({ response: { error: 'SESSION_ENDED' } });
      await expect(strategy.validate(jwt.decode(laptop.accessToken))).rejects.toThrow('Session ended');
      // the phone carries on
      await expect(strategy.validate(jwt.decode(rotated.accessToken))).resolves.toMatchObject({ id: user.id });
      await expect(tokens.rotate(rotated.refreshToken)).resolves.toHaveProperty('accessToken');

      const audit = await prisma.auditLog.findMany({ where: { userId: user.id, action: 'auth.sessions_revoked_others' } });
      expect(audit).toHaveLength(1);
    });

    it('replaying a rotated token is still treated as theft', async () => {
      const { user, number } = await ownerWithPassword();
      const first = await auth.login({ identifier: number, password }, { ip: OWNER_IP });
      await tokens.rotate(first.refreshToken);
      await expect(tokens.rotate(first.refreshToken)).rejects.toThrow(/reuse detected/);
      expect(await prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    });
  });

  describe('support-assisted recovery', () => {
    it('request → staff verify → code to the new number → new password; staff never hold the code', async () => {
      const { user, number } = await ownerWithPassword();
      const staff = await prisma.user.create({ data: { email: `staff-${randomUUID()}@test.local`, fullName: 'Support' } });
      const newNumber = phone();

      await recovery.request({ contact: number, fullName: 'Owner', proof: 'My last order was 500 MRU of PUBG UC', newContact: newNumber }, { ip: '7.7.7.7' });
      const [req] = await recovery.list();
      expect(req).toMatchObject({ userId: user.id, newContact: newNumber, status: 'PENDING' });
      expect(await prisma.staffNotification.count({ where: { type: 'recovery.new', entityId: req.id } })).toBe(1);

      const verified = await recovery.verify(req.id, staff.id, 'matched the order', { ip: '1.1.1.1' });
      expect(JSON.stringify(verified)).not.toMatch(/\d{6}/);
      const code = captureOutbox.lastCode(newNumber) as string;
      expect(code).toMatch(/^\d{6}$/);

      // nothing staff can read holds the code
      const staffAudit = await prisma.auditLog.findMany({ where: { userId: staff.id } });
      expect(JSON.stringify(staffAudit)).not.toContain(code);
      const token = await prisma.verificationToken.findFirstOrThrow({ where: { userId: user.id, purpose: 'ACCOUNT_RECOVERY' } });
      expect(token.codeEnc).toBeNull();
      expect(await auth.listRelayPending()).toEqual([]);

      const fresh = `Rc${randomUUID().slice(0, 8)}C3x`;
      await recovery.complete({ contact: newNumber, code, newPassword: fresh }, { ip: '7.7.7.7' });

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.phone).toBe(newNumber);
      expect(after.phoneVerifiedAt).toBeInstanceOf(Date);
      await expect(auth.login({ identifier: newNumber, password: fresh }, { ip: '7.7.7.7' })).resolves.toHaveProperty('accessToken');
      expect((await prisma.accountRecoveryRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe('COMPLETED');
      expect((await prisma.staffNotification.findFirstOrThrow({ where: { entityId: req.id } })).resolvedAt).toBeInstanceOf(Date);

      // the code is spent
      await expect(recovery.complete({ contact: newNumber, code, newPassword: fresh }, { ip: '7.7.7.8' })).rejects.toMatchObject({
        response: { error: 'INVALID_CODE' },
      });
    });
  });
});
