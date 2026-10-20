import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy, JwtPayload } from '../../src/modules/auth/strategies/jwt.strategy';

const SECRET = 'x'.repeat(48); // >= 32 chars, satisfies passport-jwt secretOrKey

describe('JwtStrategy', () => {
  let prisma: any;
  let config: any;
  let strategy: JwtStrategy;

  const dbUser = {
    id: 'u1',
    email: 'a@b.c',
    roles: [
      {
        role: {
          name: 'admin',
          permissions: [
            { permission: { key: 'orders.read' } },
            { permission: { key: 'orders.write' } },
          ],
        },
      },
      {
        role: {
          name: 'support',
          // duplicate key across roles must be de-duplicated
          permissions: [{ permission: { key: 'orders.read' } }],
        },
      },
    ],
  };

  const payload: JwtPayload = { sub: 'u1', email: 'a@b.c', type: 'access' };

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn().mockResolvedValue(dbUser) } };
    config = { getOrThrow: jest.fn().mockReturnValue(SECRET) };
    strategy = new JwtStrategy(config, prisma);
  });

  it('reads the access secret from config at construction', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('jwt.accessSecret');
  });

  it('resolves roles and a de-duplicated permission set for a live user', async () => {
    const user = await strategy.validate(payload);

    expect(user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      roles: ['admin', 'support'],
      permissions: ['orders.read', 'orders.write'],
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1', deletedAt: null, isActive: true, isBlocked: false },
      }),
    );
  });

  it('rejects a non-access token type without hitting the database', async () => {
    await expect(strategy.validate({ ...payload, type: 'refresh' as any })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('rejects when the user no longer exists / is unavailable', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(strategy.validate(payload)).rejects.toThrow('Account unavailable');
  });

  it('returns empty role/permission arrays for a user with no roles', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.c', roles: [] });

    const user = await strategy.validate(payload);

    expect(user).toEqual({ id: 'u1', email: 'a@b.c', roles: [], permissions: [] });
  });
});
