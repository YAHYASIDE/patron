import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from '../../src/modules/users/users.service';

describe('UsersService', () => {
  let prisma: any;
  let crypto: any;
  let tx: any;
  let service: UsersService;

  const ACTOR = 'actor-1';

  beforeEach(() => {
    tx = {
      user: { create: jest.fn(), update: jest.fn() },
      userRole: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      role: { findUniqueOrThrow: jest.fn() },
      order: { count: jest.fn() },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      // Handles both callback and array forms of $transaction.
      $transaction: jest.fn().mockImplementation((arg: any) =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
      ),
    };
    crypto = { hashPassword: jest.fn().mockResolvedValue('$argon2id$hashed') };
    service = new UsersService(prisma, crypto);
  });

  describe('findAll', () => {
    it('returns a paginated, role-flattened list with no filters', async () => {
      const rows = [
        { id: 'u1', email: 'a@b.c', roles: [{ role: { id: 'r1', name: 'customer' } }] },
      ];
      prisma.user.findMany.mockResolvedValue(rows);
      prisma.user.count.mockResolvedValue(1);

      const res = await service.findAll({ skip: 0, limit: 20, page: 1, order: 'desc' } as any);

      expect(res.data).toEqual([{ id: 'u1', email: 'a@b.c', roles: [{ id: 'r1', name: 'customer' }] }]);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 1, pages: 1 });
      // Default where only filters soft-deleted rows.
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null }, skip: 0, take: 20, orderBy: { createdAt: 'desc' } }),
      );
    });

    it('builds a compound where clause from every filter', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.findAll({
        skip: 10, limit: 5, page: 3, order: 'asc',
        isActive: true, isBlocked: false, role: 'admin', search: 'jane',
      } as any);

      const where = prisma.user.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({
        deletedAt: null,
        isActive: true,
        isBlocked: false,
        roles: { some: { role: { name: 'admin' } } },
      });
      expect(where.OR).toEqual([
        { email: { contains: 'jane', mode: 'insensitive' } },
        { fullName: { contains: 'jane', mode: 'insensitive' } },
        { phone: { contains: 'jane' } },
      ]);
    });

    it('returns an empty page when nothing matches', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const res = await service.findAll({ skip: 0, limit: 20, page: 1, order: 'desc' } as any);

      expect(res.data).toEqual([]);
      expect(res.meta.pages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns a user with flattened roles', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'u1', email: 'a@b.c',
        roles: [{ role: { id: 'r1', name: 'customer' } }],
        wallets: [], _count: { orders: 2 },
      });

      const res = await service.findOne('u1');

      expect(res).toMatchObject({ id: 'u1', roles: [{ id: 'r1', name: 'customer' }], _count: { orders: 2 } });
      expect((res as any).roles).not.toContainEqual(expect.objectContaining({ role: expect.anything() }));
    });

    it('throws NotFound when the user is missing', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the user with explicit roles and audits it', async () => {
      const created = { id: 'new-u', email: 'x@y.z' };
      tx.user.create.mockResolvedValue(created);

      const res = await service.create(
        { email: '  X@Y.Z ', phone: '123', fullName: '  Jane  ', password: 'pw', roleIds: ['r1', 'r2'] } as any,
        ACTOR,
      );

      expect(res).toBe(created);
      expect(crypto.hashPassword).toHaveBeenCalledWith('pw');
      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.email).toBe('x@y.z');
      expect(data.fullName).toBe('Jane');
      expect(data.defaultCurrency).toBe('USD');
      expect(data.roles.create).toEqual([{ roleId: 'r1' }, { roleId: 'r2' }]);
      expect(data.wallets.create).toEqual({ currencyCode: 'USD' });
      expect(prisma.role.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'users.create', entityId: 'new-u' }) }),
      );
    });

    it('falls back to the customer role and honours a custom currency', async () => {
      prisma.role.findUniqueOrThrow.mockResolvedValue({ id: 'customer-role' });
      tx.user.create.mockResolvedValue({ id: 'new-u' });

      await service.create(
        { email: 'a@b.c', fullName: 'Jo', password: 'pw', defaultCurrency: 'EUR' } as any,
        ACTOR,
      );

      expect(prisma.role.findUniqueOrThrow).toHaveBeenCalledWith({ where: { name: 'customer' } });
      const data = tx.user.create.mock.calls[0][0].data;
      expect(data.roles.create).toEqual([{ roleId: 'customer-role' }]);
      expect(data.defaultCurrency).toBe('EUR');
      expect(data.wallets.create).toEqual({ currencyCode: 'EUR' });
    });
  });

  describe('updateProfile', () => {
    it('updates the caller row directly with the given scalars', async () => {
      prisma.user.update.mockResolvedValue({ id: 'u1' });

      await service.updateProfile('u1', { fullName: 'New' } as any);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u1' }, data: { fullName: 'New' } }),
      );
    });
  });

  describe('adminUpdate', () => {
    it('remaps roles, updates scalars, and audits before/after', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', email: 'a@b.c', roles: [{ roleId: 'old' }] });
      tx.user.update.mockResolvedValue({ id: 'u1', email: 'a@b.c' });

      const res = await service.adminUpdate('u1', { isActive: false, roleIds: ['r9'] } as any, ACTOR);

      expect(res).toEqual({ id: 'u1', email: 'a@b.c' });
      expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(tx.userRole.createMany).toHaveBeenCalledWith({ data: [{ userId: 'u1', roleId: 'r9' }] });
      // Scalars only — roleIds stripped before the update.
      expect(tx.user.update.mock.calls[0][0].data).toEqual({ isActive: false });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'users.update', entityId: 'u1' }) }),
      );
    });

    it('leaves roles untouched when roleIds is omitted', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u1', roles: [] });
      tx.user.update.mockResolvedValue({ id: 'u1' });

      await service.adminUpdate('u1', { fullName: 'X' } as any, ACTOR);

      expect(tx.userRole.deleteMany).not.toHaveBeenCalled();
      expect(tx.userRole.createMany).not.toHaveBeenCalled();
    });

    it('throws NotFound for an unknown user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.adminUpdate('ghost', {} as any, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('setBlocked', () => {
    it('rejects blocking your own account', async () => {
      await expect(service.setBlocked(ACTOR, { blocked: true } as any, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFound for a missing user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.setBlocked('u2', { blocked: true } as any, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to block a super_admin', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', roles: [{ role: { name: 'super_admin' } }] });
      await expect(service.setBlocked('u2', { blocked: true } as any, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('blocks a user, revokes live sessions, and audits users.block', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', roles: [{ role: { name: 'customer' } }] });
      tx.user.update.mockResolvedValue({ id: 'u2', isBlocked: true });

      const res = await service.setBlocked('u2', { blocked: true, reason: 'fraud' } as any, ACTOR);

      expect(res).toEqual({ id: 'u2', isBlocked: true });
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u2', revokedAt: null } }),
      );
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'users.block' }) }),
      );
    });

    it('unblocking does not revoke sessions and audits users.unblock', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u2', roles: [] });
      tx.user.update.mockResolvedValue({ id: 'u2', isBlocked: false });

      await service.setBlocked('u2', { blocked: false } as any, ACTOR);

      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'users.unblock' }) }),
      );
    });
  });

  describe('remove', () => {
    it('rejects deleting your own account', async () => {
      await expect(service.remove(ACTOR, ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.order.count).not.toHaveBeenCalled();
    });

    it('rejects when the user has open orders', async () => {
      prisma.order.count.mockResolvedValue(3);
      await expect(service.remove('u2', ACTOR)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('soft-deletes, revokes sessions, audits, and returns a message', async () => {
      prisma.order.count.mockResolvedValue(0);
      prisma.user.update.mockResolvedValue({});

      const res = await service.remove('u2', ACTOR);

      expect(res).toEqual({ message: 'User deleted' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'u2' }, data: expect.objectContaining({ isActive: false }) }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalled();
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'users.delete', entityId: 'u2' }) }),
      );
    });
  });
});
