import { createHash, randomUUID } from 'crypto';
import { AuthService } from '../../src/modules/auth/auth.service';
import { CodesService } from '../../src/modules/auth/codes.service';
import { LoginGuardService } from '../../src/modules/auth/login-guard.service';
import { CaptureSmsSender, OwnerRelaySmsSender, SmsSender } from '../../src/modules/auth/senders/sms-sender';
import { CaptureEmailSender, DisabledEmailSender, EmailSender } from '../../src/modules/auth/senders/email-sender';
import { captureOutbox } from '../../src/modules/auth/senders/capture-outbox';

const META = { ip: '10.0.0.1', userAgent: 'jest' };
const PAIR = { accessToken: 'a.jwt', refreshToken: 'raw-refresh', expiresIn: 900 };
const PHONE = '+22222123456';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Email/phone + password, verification codes, resets and sessions, with the
 * real code and lockout services over an in-memory Prisma double.
 */
describe('AuthService · accounts', () => {
  let prisma: any;
  let crypto: any;
  let tokens: any;
  let config: any;
  let codesIssued: string[];

  const make = (sms: SmsSender = new OwnerRelaySmsSender(), email: EmailSender = new DisabledEmailSender()) =>
    new AuthService(prisma, crypto, tokens, config, new CodesService(prisma, crypto, config, sms, email), new LoginGuardService(prisma, config));

  const user = (over: Record<string, unknown> = {}) => ({
    id: 'u1', email: 'a@b.c', phone: PHONE, passwordHash: '$argon2id$x', locale: 'ar',
    emailVerifiedAt: null, phoneVerifiedAt: null, isActive: true, isBlocked: false, deletedAt: null, ...over,
  });

  beforeEach(() => {
    captureOutbox.clear();
    codesIssued = [];
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(user()),
        findFirstOrThrow: jest.fn().mockResolvedValue(user()),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'r' }) },
      loginAttempt: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      verificationToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })),
        update: jest.fn().mockResolvedValue({ attempts: 1 }),
      },
      $transaction: jest.fn().mockImplementation((fn: any) =>
        fn({ user: { create: jest.fn().mockResolvedValue(user({ phone: null })) }, auditLog: { create: jest.fn() } }),
      ),
    };
    crypto = {
      verifyPassword: jest.fn().mockResolvedValue(true),
      fakeVerify: jest.fn().mockResolvedValue(false),
      passwordNeedsRehash: () => false,
      hashPassword: jest.fn().mockResolvedValue('$argon2id$new'),
      sha256: sha,
      timingSafeEquals: (a: string, b: string) => a === b,
      randomNumericCode: () => {
        const c = String(100000 + codesIssued.length);
        codesIssued.push(c);
        return c;
      },
      randomToken: () => randomUUID(),
      encrypt: (v: string) => `enc:${v}`,
    };
    tokens = {
      issue: jest.fn().mockResolvedValue(PAIR),
      revokeAllForUser: jest.fn(),
      listSessions: jest.fn().mockResolvedValue([]),
      revokeSession: jest.fn().mockResolvedValue({ revoked: true }),
      revokeOtherSessions: jest.fn().mockResolvedValue({ revoked: 2 }),
    };
    config = { get: (k: string) => ({ 'currency.base': 'USD', 'security.resendCooldownSeconds': 60 })[k] };
  });

  describe('login with an email or a phone', () => {
    it('signs in with the phone number and its password', async () => {
      expect(await make().login({ identifier: PHONE, password: 'Str0ngPassword' } as any, META)).toBe(PAIR);
      expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({ phone: PHONE, deletedAt: null });
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('auth.login_phone_password');
    });

    it('accepts a spaced number and a mixed-case email', async () => {
      await make().login({ identifier: '+222 22 12 34 56', password: 'x' } as any, META);
      await make().login({ identifier: ' A@B.C ', password: 'x' } as any, META);
      expect(prisma.user.findFirst.mock.calls[0][0].where.phone).toBe(PHONE);
      expect(prisma.user.findFirst.mock.calls[1][0].where.email).toBe('a@b.c');
    });

    it('refuses something that is neither an email nor a number', async () => {
      await expect(make().login({ identifier: 'hello', password: 'x' } as any, META)).rejects.toMatchObject({
        response: { error: 'INVALID_IDENTIFIER' },
      });
    });

    it('a number account without a password cannot be opened with any password', async () => {
      prisma.user.findFirst.mockResolvedValue(user({ passwordHash: null }));
      await expect(make().login({ identifier: PHONE, password: 'Anything123' } as any, META)).rejects.toMatchObject({
        response: { error: 'INVALID_CREDENTIALS' },
      });
      expect(crypto.fakeVerify).toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('setting a first password', () => {
    it('needs a verified number', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(user({ passwordHash: null }));
      await expect(make().setPassword('u1', { newPassword: 'N3wStrongPass' }, META)).rejects.toMatchObject({
        response: { error: 'VERIFY_FIRST' },
      });
    });

    it('sets it once the number is verified, and audits it', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(user({ passwordHash: null, phoneVerifiedAt: new Date() }));
      await make().setPassword('u1', { newPassword: 'N3wStrongPass' }, META);
      expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', passwordHash: null }, data: { passwordHash: '$argon2id$new' } });
      expect(prisma.auditLog.create.mock.calls[0][0].data.action).toBe('auth.password_set');
    });

    it('will not overwrite an existing password (change it instead)', async () => {
      await expect(make().setPassword('u1', { newPassword: 'N3wStrongPass' }, META)).rejects.toMatchObject({
        response: { error: 'PASSWORD_ALREADY_SET' },
      });
    });
  });

  describe('email verification', () => {
    it('answers EMAIL_NOT_CONFIGURED when email is off', async () => {
      await expect(make().resendEmailCode('u1')).rejects.toMatchObject({ response: { error: 'EMAIL_NOT_CONFIGURED' } });
    });

    it('sends a hashed 6-digit code that lives about 15 minutes', async () => {
      const res = await make(undefined, new CaptureEmailSender()).resendEmailCode('u1');
      expect(res).toEqual({ status: 'SENT' });
      const data = prisma.verificationToken.create.mock.calls[0][0].data;
      expect(data.purpose).toBe('EMAIL_VERIFY');
      expect(data.codeHash).toBe(sha(codesIssued[0]));
      expect(data.codeEnc).toBeUndefined();
      const minutes = (data.expiresAt.getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(14);
      expect(minutes).toBeLessThanOrEqual(15);
      expect(captureOutbox.lastCode('a@b.c')).toBe(codesIssued[0]);
    });

    it('makes the customer wait before another code', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });
      await expect(make(undefined, new CaptureEmailSender()).resendEmailCode('u1')).rejects.toMatchObject({
        response: { error: 'RESEND_COOLDOWN', retryAfter: 50 },
      });
      expect(captureOutbox.email).toHaveLength(0);
    });

    it('does nothing for a verified email', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(user({ emailVerifiedAt: new Date() }));
      expect(await make(undefined, new CaptureEmailSender()).resendEmailCode('u1')).toEqual({ status: 'VERIFIED' });
    });

    it('sends the code at sign-up when email is on, and still signs up when it is off', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      const dto = { email: 'new@b.c', password: 'Str0ngPassword', fullName: 'New' } as any;
      await make(undefined, new CaptureEmailSender()).register(dto, META);
      expect(captureOutbox.email[0]).toMatchObject({ to: 'new@b.c' });
      expect(await make().register(dto, META)).toBe(PAIR);
    });
  });

  describe('password reset by email or by phone', () => {
    it('gives the same answer whether the number has an account or not', async () => {
      const known = await make().forgotPassword({ identifier: PHONE });
      prisma.user.findFirst.mockResolvedValue(null);
      const unknown = await make().forgotPassword({ identifier: '+22299999999' });
      expect(known).toEqual(unknown);
    });

    it('relays a phone reset code to the owner under the default provider', async () => {
      await make().forgotPassword({ identifier: PHONE });
      expect(prisma.verificationToken.create.mock.calls[0][0].data).toMatchObject({ purpose: 'PASSWORD_RESET', codeEnc: `enc:${codesIssued[0]}` });
    });

    it('sends it by SMS provider (capture) without keeping a readable copy', async () => {
      await make(new CaptureSmsSender()).forgotPassword({ identifier: PHONE });
      expect(prisma.verificationToken.create.mock.calls[0][0].data.codeEnc).toBeUndefined();
      expect(captureOutbox.lastCode(PHONE)).toBe(codesIssued[0]);
    });

    it('by email: EMAIL_NOT_CONFIGURED depends on the server, never on the account', async () => {
      await expect(make().forgotPassword({ email: 'a@b.c' })).rejects.toMatchObject({ response: { error: 'EMAIL_NOT_CONFIGURED' } });
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(make().forgotPassword({ email: 'ghost@b.c' })).rejects.toMatchObject({ response: { error: 'EMAIL_NOT_CONFIGURED' } });
    });

    it('a send failure does not change the answer', async () => {
      const failing: SmsSender = { ...new CaptureSmsSender(), name: 'capture', relayedByStaff: false, providerChecksCode: false, send: () => Promise.reject(new Error('down')), check: () => Promise.resolve(false) };
      expect(await make(failing).forgotPassword({ identifier: PHONE })).toMatchObject({ channel: 'phone' });
    });

    it('sets the password only after the code is proven, marks the number verified and ends every session', async () => {
      const svc = make(new CaptureSmsSender());
      await svc.forgotPassword({ identifier: PHONE });
      const code = captureOutbox.lastCode(PHONE) as string;
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 't1', codeHash: sha(code), attempts: 0, expiresAt: new Date(Date.now() + 60_000),
      });

      await svc.resetPassword({ identifier: PHONE, code, newPassword: 'N3wStrongPass' }, META);
      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.passwordHash).toBe('$argon2id$new');
      expect(data.phoneVerifiedAt).toBeInstanceOf(Date);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
    });

    it('a wrong code changes nothing and counts against this device', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 't1', codeHash: sha('123456'), attempts: 0, expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(make().resetPassword({ identifier: PHONE, code: '654321', newPassword: 'N3wStrongPass' }, META))
        .rejects.toMatchObject({ response: { error: 'INVALID_CODE' } });
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.loginAttempt.create.mock.calls[0][0].data).toMatchObject({ identifier: PHONE, ipAddress: META.ip, success: false });
    });
  });

  describe('profile and sessions', () => {
    it('says whether a password exists without returning the hash', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...user(), roles: [{ role: { name: 'customer' } }], _count: { passkeys: 2 } });
      const me = await make().me('u1');
      expect(me).toMatchObject({ hasPassword: true, passkeyCount: 2, roles: ['customer'] });
      expect(JSON.stringify(me)).not.toContain('argon2');
    });

    it('lists, revokes one and revokes the others, auditing each', async () => {
      const svc = make();
      await svc.listSessions('u1', 's1');
      await svc.revokeSession('u1', 's2', META);
      await svc.revokeOtherSessions('u1', 's1', META);
      expect(tokens.listSessions).toHaveBeenCalledWith('u1', 's1');
      expect(tokens.revokeSession).toHaveBeenCalledWith('u1', 's2');
      expect(tokens.revokeOtherSessions).toHaveBeenCalledWith('u1', 's1');
      expect(prisma.auditLog.create.mock.calls.map((c: any) => c[0].data.action)).toEqual([
        'auth.session_revoked', 'auth.sessions_revoked_others',
      ]);
    });
  });
});
