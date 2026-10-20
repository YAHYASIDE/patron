import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { TokenService } from '../../src/modules/auth/token.service';

const RAW_TOKEN = 'raw-refresh-token';
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('TokenService', () => {
  let prisma: any;
  let crypto: any;
  let metrics: any;
  let jwt: any;
  let service: TokenService;

  const activeUser = { id: 'u1', email: 'a@b.c', isActive: true, isBlocked: false, deletedAt: null };
  const stored = (over: Record<string, unknown> = {}) => ({
    id: 't1', userId: 'u1', sessionId: 's1', revokedAt: null, replacedBy: null, deviceInfo: 'iPhone · Safari', ipAddress: '1.1.1.1',
    expiresAt: new Date(Date.now() + 86400e3), user: activeUser, ...over,
  });

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new-row', ...data })),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ id: 'live' }),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
    // A real digest, not `hash(${v})`. The previous stub echoed its input, so
    // the "raw token is never stored" assertion below could never fail — the
    // fake hash contained the plaintext it was supposed to hide.
    crypto = { sha256, randomToken: () => RAW_TOKEN };
    metrics = { tokenReuseDetected: { inc: jest.fn() } };

    jwt = { signAsync: jest.fn().mockResolvedValue('access.jwt') };
    const config = {
      getOrThrow: () => 'secret',
      get: (k: string) => (k === 'jwt.accessTtl' ? '15m' : '30d'),
    };
    service = new TokenService(jwt as any, config as any, prisma, crypto, metrics);
  });

  it('stores only a hash of the refresh token', async () => {
    await service.issue('u1', 'a@b.c');
    const { data } = prisma.refreshToken.create.mock.calls[0][0];

    expect(data.tokenHash).toBe(sha256(RAW_TOKEN));
    expect(JSON.stringify(data)).not.toContain(RAW_TOKEN);
  });

  it('starts a device session: id in the access token, device named from the user agent', async () => {
    await service.issue('u1', 'a@b.c', { ip: '2.2.2.2', userAgent: IPHONE_UA });
    const { data } = prisma.refreshToken.create.mock.calls[0][0];
    expect(data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.deviceInfo).toBe('iPhone · Safari');
    expect(data.ipAddress).toBe('2.2.2.2');
    expect(data.lastUsedAt).toBeInstanceOf(Date);
    expect(jwt.signAsync.mock.calls[0][0]).toMatchObject({ sub: 'u1', type: 'access', sid: data.sessionId });
  });

  it('prefers the label the client sent', async () => {
    await service.issue('u1', null, { deviceInfo: ' Pixel 8 ', userAgent: IPHONE_UA });
    expect(prisma.refreshToken.create.mock.calls[0][0].data.deviceInfo).toBe('Pixel 8');
  });

  it('rotates a valid token inside the same session and links the old row to the new one', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored());

    await service.rotate(RAW_TOKEN, { ip: '3.3.3.3' });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({ where: { id: 't1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    const { data } = prisma.refreshToken.create.mock.calls[0][0];
    expect(data).toMatchObject({ sessionId: 's1', deviceInfo: 'iPhone · Safari', ipAddress: '3.3.3.3' });
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { replacedBy: 'new-row' } });
  });

  it('gives a pre-sessions token a session on its first rotation', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ sessionId: null }));
    await service.rotate(RAW_TOKEN);
    expect(prisma.refreshToken.create.mock.calls[0][0].data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('revokes everything when an already-rotated token is replayed', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date(), replacedBy: 'next' }));

    await expect(service.rotate('stolen')).rejects.toThrow(/reuse detected/);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1', revokedAt: null } }),
    );
    expect(metrics.tokenReuseDetected.inc).toHaveBeenCalled();
  });

  it('a signed-out token is simply over — not an alarm that signs out every device', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ revokedAt: new Date(), replacedBy: null }));

    await expect(service.rotate('old')).rejects.toMatchObject({ response: { error: 'SESSION_ENDED' } });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    expect(metrics.tokenReuseDetected.inc).not.toHaveBeenCalled();
  });

  it('two refreshes racing on the live token both stay signed in, in the same session', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored());
    prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 }); // the other request won

    const pair = await service.rotate(RAW_TOKEN);
    expect(pair.refreshToken).toBe(RAW_TOKEN);
    expect(prisma.refreshToken.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { sessionId: 's1', revokedAt: null } }));
    expect(prisma.refreshToken.create.mock.calls[0][0].data.sessionId).toBe('s1');
    expect(metrics.tokenReuseDetected.inc).not.toHaveBeenCalled();
  });

  it('…unless that session was signed out meanwhile', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored());
    prisma.refreshToken.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.refreshToken.findFirst.mockResolvedValue(null);
    await expect(service.rotate(RAW_TOKEN)).rejects.toMatchObject({ response: { error: 'SESSION_ENDED' } });
  });

  it('rejects an expired token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.rotate('old')).rejects.toThrow(UnauthorizedException);
  });

  it('rejects rotation for a blocked account', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(stored({ user: { ...activeUser, isBlocked: true } }));
    await expect(service.rotate('token')).rejects.toThrow(/Account unavailable/);
  });

  it('rejects an unknown token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('nonsense')).rejects.toThrow(UnauthorizedException);
  });

  it('signing out ends the whole device session', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({ id: 't1', sessionId: 's1', userId: 'u1' });
    await service.revoke(RAW_TOKEN);
    expect(prisma.refreshToken.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', sessionId: 's1', revokedAt: null });

    prisma.refreshToken.findUnique.mockResolvedValue({ id: 't0', sessionId: null, userId: 'u1' });
    await service.revoke(RAW_TOKEN);
    expect(prisma.refreshToken.updateMany.mock.calls[1][0].where).toEqual({ id: 't0', revokedAt: null });

    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await service.revoke('unknown');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(2);
  });

  describe('sessions & devices', () => {
    const t = (min: number) => new Date(Date.now() - min * 60_000);

    it('lists one row per device, the current first, with when it first signed in', async () => {
      prisma.refreshToken.findMany.mockResolvedValue([
        { id: 'r1', sessionId: 'sA', deviceInfo: 'Windows · Chrome', ipAddress: '1.1.1.1', createdAt: t(5), lastUsedAt: t(1) },
        { id: 'r2', sessionId: 'sB', deviceInfo: 'iPhone · Safari', ipAddress: '2.2.2.2', createdAt: t(10), lastUsedAt: t(2) },
        { id: 'r3', sessionId: 'sB', deviceInfo: 'iPhone · Safari', ipAddress: '2.2.2.2', createdAt: t(11), lastUsedAt: t(3) },
        { id: 'legacy', sessionId: null, deviceInfo: null, ipAddress: null, createdAt: t(60), lastUsedAt: null },
      ]);
      prisma.refreshToken.groupBy.mockResolvedValue([{ sessionId: 'sB', _min: { createdAt: t(600) } }]);

      const list = await service.listSessions('u1', 'sB');
      expect(list.map((s) => s.id)).toEqual(['sB', 'sA', 'legacy']);
      expect(list[0]).toMatchObject({ current: true, signedInAt: t(600) });
      expect(list[1]).toMatchObject({ current: false, signedInAt: t(5) });
      expect(list[2].lastUsedAt).toEqual(t(60));
    });

    it('skips the grouping query when there is nothing to group', async () => {
      expect(await service.listSessions('u1')).toEqual([]);
      expect(prisma.refreshToken.groupBy).not.toHaveBeenCalled();
    });

    it('revokes one session of mine (and only mine)', async () => {
      await service.revokeSession('u1', 'sA');
      expect(prisma.refreshToken.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'u1', revokedAt: null, OR: [{ sessionId: 'sA' }, { id: 'sA', sessionId: null }],
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.revokeSession('u1', 'not-mine')).rejects.toMatchObject({ response: { error: 'SESSION_NOT_FOUND' } });
    });

    it('revokes every other session, keeping this one', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });
      expect(await service.revokeOtherSessions('u1', 'sB')).toEqual({ revoked: 3 });
      expect(prisma.refreshToken.updateMany.mock.calls[0][0].where).toEqual({
        userId: 'u1', revokedAt: null, OR: [{ sessionId: null }, { sessionId: { not: 'sB' } }],
      });
      await expect(service.revokeOtherSessions('u1', undefined)).rejects.toMatchObject({ response: { error: 'SESSION_UNKNOWN' } });
    });
  });
});
