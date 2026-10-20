import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../../src/modules/auth/auth.service';

const META = { ip: '1.2.3.4', userAgent: 'jest' };
const PAIR = { accessToken: 'a.jwt', refreshToken: 'raw-refresh', expiresIn: 900 };

describe('AuthService', () => {
  let prisma: any;
  let crypto: any;
  let tokens: any;
  let config: any;
  let service: AuthService;

  const user = {
    id: 'u1', email: 'a@b.c', passwordHash: '$argon2id$stored',
    isActive: true, isBlocked: false, deletedAt: null,
  };

  beforeEach(() => {
    prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) },
      loginAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      refreshToken: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1' }) },
    };
    crypto = {
      verifyPassword: jest.fn().mockResolvedValue(true),
      fakeVerify: jest.fn().mockResolvedValue(false),
      passwordNeedsRehash: jest.fn().mockReturnValue(false),
      hashPassword: jest.fn().mockResolvedValue('$argon2id$new'),
      sha256: (v: string) => `sha:${v}`,
    };
    tokens = {
      issue: jest.fn().mockResolvedValue(PAIR),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    config = {
      get: (k: string) => ({ 'security.maxLoginAttempts': 5, 'security.lockoutMinutes': 15 }[k]),
    };
    service = new AuthService(prisma, crypto, tokens, config);
  });

  describe('login', () => {
    const dto = { email: 'A@B.c', password: 'Str0ngPass!' } as any;

    it('authenticates, records a successful attempt, and audits the login', async () => {
      const res = await service.login(dto, META);

      expect(res).toBe(PAIR);
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ success: true, identifier: 'a@b.c' }) }),
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.login', userId: 'u1' }) }),
      );
      expect(tokens.issue).toHaveBeenCalledWith('u1', 'a@b.c', { ip: META.ip, deviceInfo: undefined });
    });

    it('transparently upgrades a legacy bcrypt hash to Argon2id', async () => {
      crypto.passwordNeedsRehash.mockReturnValue(true);

      await service.login(dto, META);

      expect(crypto.hashPassword).toHaveBeenCalledWith('Str0ngPass!');
      expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toBe('$argon2id$new');
    });

    it('does not rehash an already-Argon2id hash', async () => {
      await service.login(dto, META);

      expect(crypto.hashPassword).not.toHaveBeenCalled();
      expect(prisma.user.update.mock.calls[0][0].data.passwordHash).toBeUndefined();
    });

    it('rejects invalid credentials and records a failed attempt', async () => {
      crypto.verifyPassword.mockResolvedValue(false);

      await expect(service.login(dto, META)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.loginAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ success: false, reason: 'invalid_credentials' }) }),
      );
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('runs a constant-time fake verify when the email does not exist', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login(dto, META)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(crypto.fakeVerify).toHaveBeenCalledWith('Str0ngPass!');
      expect(crypto.verifyPassword).not.toHaveBeenCalled();
    });

    it('blocks and does not issue tokens after too many failed attempts', async () => {
      prisma.loginAttempt.count.mockResolvedValue(5);

      await expect(service.login(dto, META)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('rejects a blocked account', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...user, isBlocked: true });
      await expect(service.login(dto, META)).rejects.toBeInstanceOf(ForbiddenException);
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the token and audits the logout against the resolved user', async () => {
      const res = await service.logout('raw-refresh', META);

      expect(tokens.revoke).toHaveBeenCalledWith('raw-refresh');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.logout', userId: 'u1' }) }),
      );
      expect(res).toEqual({ message: 'Logged out' });
    });

    it('still revokes but skips the audit when the token is unknown', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await service.logout('ghost', META);

      expect(tokens.revoke).toHaveBeenCalledWith('ghost');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    it('revokes every session and audits it', async () => {
      const res = await service.logoutAll('u1', META);

      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('u1');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'auth.logout_all', userId: 'u1' }) }),
      );
      expect(res).toEqual({ message: 'All sessions revoked' });
    });
  });
});

describe('AuthService · WhatsApp number sign-in', () => {
  let prisma: any;
  let crypto: any;
  let tokens: any;
  let txUserCreate: jest.Mock;
  let service: AuthService;
  const PHONE = '+22222123456';

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findFirstOrThrow: jest.fn(),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data })),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-customer' }) },
      loginAttempt: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      verificationToken: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(),
    };
    txUserCreate = jest.fn().mockResolvedValue({ id: 'new-user' });
    prisma.$transaction.mockImplementation((fn: (tx: any) => unknown) =>
      fn({ user: { create: txUserCreate }, auditLog: { create: jest.fn() } }),
    );
    crypto = {
      fakeVerify: jest.fn(),
      sha256: (v: string) => `sha:${v}`,
      timingSafeEquals: (a: string, b: string) => a === b,
      randomNumericCode: () => '482913',
      encrypt: (v: string) => `enc:${v}`,
      decrypt: (v: string) => v.replace(/^enc:/, ''),
    };
    tokens = { issue: jest.fn().mockResolvedValue(PAIR) };
    const config = {
      get: (k: string) =>
        ({ 'security.maxLoginAttempts': 5, 'security.lockoutMinutes': 15, 'security.relayedOtpTtlSeconds': 1800, 'currency.base': 'USD' })[k],
    };
    service = new AuthService(prisma, crypto, tokens, config as any);
  });

  const existing = (over: Record<string, unknown> = {}) => ({
    id: 'u1', email: null, phone: PHONE, passwordHash: null, phoneVerifiedAt: null,
    isActive: true, isBlocked: false, _count: { orders: 0 }, ...over,
  });

  describe('phoneStart', () => {
    it('creates a new customer from a number and a name, and signs them in unverified', async () => {
      const res = await service.phoneStart({ phone: PHONE, fullName: ' سيدي أحمد ' }, META);

      expect(res).toEqual({ status: 'SIGNED_IN', ...PAIR });
      expect(tokens.issue).toHaveBeenCalledWith('new-user', null, expect.anything());
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
      // the WhatsApp number's dial code says where the customer is
      expect(txUserCreate.mock.calls[0][0].data.country).toBe('MR');
    });

    it('stores the referral code a new account came with, inside the same transaction', async () => {
      const agentFind = jest.fn().mockResolvedValue({ id: 'ag1', userId: 'agent-user', isActive: true });
      const userUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementation((fn: (tx: any) => unknown) =>
        fn({ user: { create: txUserCreate, updateMany: userUpdateMany }, agent: { findUnique: agentFind }, auditLog: { create: jest.fn() } }),
      );
      await service.phoneStart({ phone: PHONE, fullName: 'سيدي أحمد', ref: 'k7mxq2' }, META);
      expect(agentFind).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'K7MXQ2' } }));
      expect(userUpdateMany).toHaveBeenCalledWith({ where: { id: 'new-user', referredByAgentId: null }, data: { referredByAgentId: 'ag1' } });
    });

    it('asks a new number for a name', async () => {
      await expect(service.phoneStart({ phone: PHONE }, META)).rejects.toMatchObject({ response: { error: 'NAME_REQUIRED' } });
    });

    it('lets an unverified number with no orders back in without a code', async () => {
      prisma.user.findFirst.mockResolvedValue(existing());
      expect(await service.phoneStart({ phone: PHONE, fullName: 'Ignored' }, META)).toEqual({ status: 'SIGNED_IN', ...PAIR });
    });

    it.each([
      ['a verified number', { phoneVerifiedAt: new Date() }],
      ['an account with a password', { passwordHash: '$argon2id$x' }],
      ['an account with orders', { _count: { orders: 2 } }],
    ])('requires a relayed code for %s, never a session', async (_label, over) => {
      prisma.user.findFirst.mockResolvedValue(existing(over));

      expect(await service.phoneStart({ phone: PHONE, fullName: 'Someone Else' }, META)).toEqual({ status: 'CODE_REQUIRED' });
      expect(tokens.issue).not.toHaveBeenCalled();
      const data = prisma.verificationToken.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ purpose: 'PHONE_LOGIN', codeHash: 'sha:482913', codeEnc: 'enc:482913' });
      expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000); // owner has time to send it
    });

    it('reuses the live relayed code instead of replacing one the owner may have sent', async () => {
      prisma.user.findFirst.mockResolvedValue(existing({ phoneVerifiedAt: new Date() }));
      prisma.verificationToken.findFirst.mockResolvedValue({ codeEnc: 'enc:111111' });

      await service.phoneStart({ phone: PHONE }, META);
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
      expect(prisma.verificationToken.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a blocked account', async () => {
      prisma.user.findFirst.mockResolvedValue(existing({ isBlocked: true }));
      await expect(service.phoneStart({ phone: PHONE }, META)).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('phoneLogin', () => {
    it('signs in with the relayed code and marks the number verified', async () => {
      prisma.user.findFirst.mockResolvedValue(existing({ passwordHash: '$x' }));
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 't1', codeHash: 'sha:482913', expiresAt: new Date(Date.now() + 60_000), attempts: 0,
      });

      expect(await service.phoneLogin({ phone: PHONE, code: '482913' }, META)).toBe(PAIR);
      expect(prisma.user.update.mock.calls[0][0].data.phoneVerifiedAt).toBeInstanceOf(Date);
    });

    it('counts a wrong code as a failed attempt (toward the lockout)', async () => {
      prisma.user.findFirst.mockResolvedValue(existing());
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 't1', codeHash: 'sha:482913', expiresAt: new Date(Date.now() + 60_000), attempts: 0,
      });

      await expect(service.phoneLogin({ phone: PHONE, code: '000000' }, META)).rejects.toThrow('Invalid or expired code');
      expect(prisma.loginAttempt.create.mock.calls[0][0].data).toMatchObject({ identifier: PHONE, success: false });
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('verification of a signed-in customer', () => {
    it('issues a relayed PHONE_VERIFY code', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(existing());
      expect(await service.requestPhoneCode('u1', {})).toEqual({ status: 'SENT', phone: PHONE });
      expect(prisma.verificationToken.create.mock.calls[0][0].data).toMatchObject({ purpose: 'PHONE_VERIFY', codeEnc: 'enc:482913' });
    });

    it('adds the number first when the account had none (an older email account)', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(existing({ phone: null, email: 'a@b.c' }));
      prisma.user.findFirst.mockResolvedValue(null);

      await service.requestPhoneCode('u1', { phone: PHONE });
      // the dial code gives the country when the customer has not chosen one
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ phone: PHONE, country: 'MR' });
    });

    it('keeps a country the customer already chose when adding the number', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(existing({ phone: null, country: 'SN' }));
      prisma.user.findFirst.mockResolvedValue(null);

      await service.requestPhoneCode('u1', { phone: PHONE });
      expect(prisma.user.update.mock.calls[0][0].data).toEqual({ phone: PHONE, country: 'SN' });
    });

    it('will not take a number that belongs to another account', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(existing({ phone: null }));
      prisma.user.findFirst.mockResolvedValue({ id: 'someone-else' });
      await expect(service.requestPhoneCode('u1', { phone: PHONE })).rejects.toThrow('another account');
    });

    it('does nothing for a number already verified', async () => {
      prisma.user.findFirstOrThrow.mockResolvedValue(existing({ phoneVerifiedAt: new Date() }));
      expect((await service.requestPhoneCode('u1', {})).status).toBe('VERIFIED');
      expect(prisma.verificationToken.create).not.toHaveBeenCalled();
    });

    it('verifies the number with the code', async () => {
      prisma.verificationToken.findFirst.mockResolvedValue({
        id: 't1', codeHash: 'sha:482913', expiresAt: new Date(Date.now() + 60_000), attempts: 0,
      });
      await service.verifyPhone('u1', { code: '482913' });
      expect(prisma.user.update.mock.calls[0][0].data.phoneVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe("the owner's relay queue", () => {
    it('lists live relayed codes, decrypted, without the ciphertext', async () => {
      prisma.verificationToken.findMany.mockResolvedValue([
        { id: 't1', purpose: 'PHONE_VERIFY', codeEnc: 'enc:482913', user: { fullName: 'Sidi', phone: PHONE } },
      ]);
      const [row] = await service.listRelayPending();
      expect(row).toMatchObject({ id: 't1', code: '482913', user: { phone: PHONE } });
      expect(row).not.toHaveProperty('codeEnc');
    });

    it('records the send in the audit log without the code', async () => {
      await service.markRelaySent('t1', 'admin-1');
      const entry = prisma.auditLog.create.mock.calls[0][0].data;
      expect(entry).toMatchObject({ action: 'auth.code_relayed', entityId: 't1', userId: 'admin-1' });
      expect(JSON.stringify(entry)).not.toContain('482913');
    });
  });
});
