import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RolesService } from '../../src/modules/roles/roles.service';

describe('RolesService', () => {
  let prisma: any;
  let tx: any;
  let service: RolesService;

  const ACTOR = 'actor-1';

  beforeEach(() => {
    tx = {
      role: { create: jest.fn(), update: jest.fn() },
      rolePermission: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      role: { findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
      permission: { count: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((arg: any) =>
        typeof arg === 'function' ? arg(tx) : Promise.all(arg),
      ),
    };
    service = new RolesService(prisma);
  });

  describe('findAll', () => {
    it('flattens permissions on every role', async () => {
      prisma.role.findMany.mockResolvedValue([
        { id: 'r1', name: 'admin', permissions: [{ permission: { id: 'p1', key: 'users.read', module: 'users' } }], _count: { users: 3 } },
      ]);

      const res = await service.findAll();

      expect(res).toEqual([
        { id: 'r1', name: 'admin', permissions: [{ id: 'p1', key: 'users.read', module: 'users' }], _count: { users: 3 } },
      ]);
    });

    it('handles a role with no permissions', async () => {
      prisma.role.findMany.mockResolvedValue([{ id: 'r1', name: 'empty', permissions: [], _count: { users: 0 } }]);
      const res = await service.findAll();
      expect(res[0].permissions).toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns a flattened role', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'r1', name: 'admin',
        permissions: [{ permission: { id: 'p1', key: 'users.read' } }],
        _count: { users: 1 },
      });

      const res = await service.findOne('r1');

      expect(res).toMatchObject({ id: 'r1', permissions: [{ id: 'p1', key: 'users.read' }] });
    });

    it('throws NotFound for a missing role', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a non-system role with permissions and audits it', async () => {
      prisma.permission.count.mockResolvedValue(2);
      tx.role.create.mockResolvedValue({ id: 'r-new', name: 'ops' });

      const res = await service.create({ name: 'ops', description: 'd', permissionIds: ['p1', 'p2'] } as any, ACTOR);

      expect(res).toEqual({ id: 'r-new', name: 'ops' });
      const data = tx.role.create.mock.calls[0][0].data;
      expect(data.isSystem).toBe(false);
      expect(data.permissions.create).toEqual([{ permissionId: 'p1' }, { permissionId: 'p2' }]);
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'roles.create', entityId: 'r-new' }) }),
      );
    });

    it('creates a role with no permissions', async () => {
      tx.role.create.mockResolvedValue({ id: 'r-new' });

      await service.create({ name: 'bare' } as any, ACTOR);

      // No ids -> assertPermissionsExist short-circuits, count never called.
      expect(prisma.permission.count).not.toHaveBeenCalled();
      expect(tx.role.create.mock.calls[0][0].data.permissions.create).toEqual([]);
    });

    it('rejects when a permission id is invalid', async () => {
      prisma.permission.count.mockResolvedValue(1); // only 1 of 2 found
      await expect(
        service.create({ name: 'ops', permissionIds: ['p1', 'bad'] } as any, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('throws NotFound for a missing role', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.update('ghost', {} as any, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to re-scope super_admin permissions', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'super_admin', isSystem: true });
      await expect(
        service.update('r1', { permissionIds: ['p1'] } as any, ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.permission.count).not.toHaveBeenCalled();
    });

    it('allows editing a system role that is not super_admin', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'admin', isSystem: true });
      prisma.permission.count.mockResolvedValue(1);
      tx.role.update.mockResolvedValue({ id: 'r1' });

      await service.update('r1', { permissionIds: ['p1'] } as any, ACTOR);

      expect(tx.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r1' } });
      expect(tx.rolePermission.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: [{ roleId: 'r1', permissionId: 'p1' }], skipDuplicates: true }),
      );
    });

    it('remaps permissions, updates description, and audits before/after', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'ops', isSystem: false });
      prisma.permission.count.mockResolvedValue(2);
      tx.role.update.mockResolvedValue({ id: 'r1', description: 'new' });

      const res = await service.update('r1', { description: 'new', permissionIds: ['p1', 'p2'] } as any, ACTOR);

      expect(res).toEqual({ id: 'r1', description: 'new' });
      expect(tx.role.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { description: 'new' } });
      expect(tx.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'roles.update', entityId: 'r1' }) }),
      );
    });

    it('updates description only when no permissionIds given', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', name: 'ops', isSystem: false });
      tx.role.update.mockResolvedValue({ id: 'r1' });

      await service.update('r1', { description: 'just desc' } as any, ACTOR);

      expect(tx.rolePermission.deleteMany).not.toHaveBeenCalled();
      expect(tx.rolePermission.createMany).not.toHaveBeenCalled();
      expect(prisma.permission.count).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('throws NotFound for a missing role', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.remove('ghost', ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to delete a system role', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: true, _count: { users: 0 } });
      await expect(service.remove('r1', ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a role still held by users', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: false, _count: { users: 4 } });
      await expect(service.remove('r1', ACTOR)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('deletes an unused custom role, audits it, and returns a message', async () => {
      prisma.role.findUnique.mockResolvedValue({ id: 'r1', isSystem: false, _count: { users: 0 } });

      const res = await service.remove('r1', ACTOR);

      expect(res).toEqual({ message: 'Role deleted' });
      expect(prisma.role.delete).toHaveBeenCalledWith({ where: { id: 'r1' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'roles.delete', entityId: 'r1' }) }),
      );
    });
  });
});
