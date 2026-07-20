import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../../src/modules/auth/token.service';

describe('TokenService', () => {
  let prisma: any;
  let crypto: any;
  let metrics: any;
  let service: TokenService;

  const activeUser = { id: 'u1', email: 'a@b.c', isActive: true, isBlocked: false, deletedAt: null };

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 3 }),
      },
    };
    crypto = { sha256: (v: string) => `hash(${v})`, randomToken: () => 'raw-refresh-token' };
    metrics = { tokenReuseDetected: { inc: jest.fn() } };

    const jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
    const config = {
      getOrThrow: () => 'secret',
      get: (k: string) => (k === 'jwt.accessTtl' ? '15m' : '30d'),
    };
    service = new TokenService(jwt as any, config as any, prisma, crypto, metrics);
  });

  it('stores only a hash of the refresh token', async () => {
    await service.issue('u1', 'a@b.c');
    const { data } = prisma.refreshToken.create.mock.calls[0][0];

    expect(data.tokenHash).toBe('hash(raw-refresh-token)');
    expect(JSON.stringify(data)).not.toContain('raw-refresh-token');
  });

  it('rotates a valid token and revokes the old one', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null,
      expiresAt: new Date(Date.now() + 86400e3), user: activeUser,
    });

    await service.rotate('raw-refresh-token');
    expect(prisma.refreshToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } }),
    );
  });

  it('revokes the whole family when an already-rotated token is presented', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400e3), user: activeUser,
    });

    await expect(service.rotate('stolen')).rejects.toThrow(/reuse detected/);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(metrics.tokenReuseDetected.inc).toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null,
      expiresAt: new Date(Date.now() - 1000), user: activeUser,
    });
    await expect(service.rotate('old')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects rotation for a blocked account', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 't1', userId: 'u1', revokedAt: null, expiresAt: new Date(Date.now() + 86400e3),
      user: { ...activeUser, isBlocked: true },
    });
    await expect(service.rotate('token')).rejects.toThrow(/Account unavailable/);
  });

  it('rejects an unknown token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('nonsense')).rejects.toThrow(UnauthorizedException);
  });
});
