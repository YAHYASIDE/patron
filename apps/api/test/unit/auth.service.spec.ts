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
