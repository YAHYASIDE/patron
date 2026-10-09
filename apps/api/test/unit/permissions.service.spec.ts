import { PermissionsService } from '../../src/modules/permissions/permissions.service';

describe('PermissionsService', () => {
  let prisma: any;
  let service: PermissionsService;

  beforeEach(() => {
    prisma = { permission: { findMany: jest.fn() } };
    service = new PermissionsService(prisma);
  });

  describe('findAllGrouped', () => {
    it('groups permissions by module, preserving order within a module', async () => {
      prisma.permission.findMany.mockResolvedValue([
        { id: 'p1', key: 'users.read', module: 'users' },
        { id: 'p2', key: 'users.write', module: 'users' },
        { id: 'p3', key: 'roles.manage', module: 'roles' },
      ]);

      const res = await service.findAllGrouped();

      expect(Object.keys(res)).toEqual(['users', 'roles']);
      expect(res.users).toEqual([
        { id: 'p1', key: 'users.read', module: 'users' },
        { id: 'p2', key: 'users.write', module: 'users' },
      ]);
      expect(res.roles).toEqual([{ id: 'p3', key: 'roles.manage', module: 'roles' }]);
      // Deterministic ordering is requested from the database.
      expect(prisma.permission.findMany).toHaveBeenCalledWith({
        orderBy: [{ module: 'asc' }, { key: 'asc' }],
      });
    });

    it('returns an empty object when there are no permissions', async () => {
      prisma.permission.findMany.mockResolvedValue([]);
      await expect(service.findAllGrouped()).resolves.toEqual({});
    });

    it('creates a single-entry group for a lone module', async () => {
      prisma.permission.findMany.mockResolvedValue([{ id: 'p1', key: 'a.b', module: 'billing' }]);
      const res = await service.findAllGrouped();
      expect(res).toEqual({ billing: [{ id: 'p1', key: 'a.b', module: 'billing' }] });
    });
  });
});
