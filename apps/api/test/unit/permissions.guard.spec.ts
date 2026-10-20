import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';

const contextWith = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  }) as any;

describe('PermissionsGuard', () => {
  let reflector: Reflector;
  let guard: PermissionsGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  /** all = @RequirePermissions, any = @RequireAnyPermission. */
  const requiring = (all: string[] | undefined, any?: string[]) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation(((key: string) =>
      key === PERMISSIONS_KEY ? all : key === ANY_PERMISSIONS_KEY ? any : undefined) as never);
  const staff = (permissions: string[]) => ({ roles: ['admin'], permissions });

  it('allows routes that declare no permissions', () => {
    requiring(undefined);
    expect(guard.canActivate(contextWith(undefined))).toBe(true);
  });

  it('rejects an unauthenticated request on a guarded route', () => {
    requiring(['orders.read']);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });

  it('requires every listed permission, not just one', () => {
    requiring(['catalog.write', 'catalog.pricing']);
    const user = { roles: ['admin'], permissions: ['catalog.write'] };
    expect(() => guard.canActivate(contextWith(user))).toThrow(/catalog.pricing/);
  });

  it('lets super_admin through without an explicit grant', () => {
    requiring(['anything.at.all']);
    expect(guard.canActivate(contextWith({ roles: ['super_admin'], permissions: [] }))).toBe(true);
  });

  describe('any-of (@RequireAnyPermission)', () => {
    it('passes with any one of the listed permissions', () => {
      requiring(undefined, ['markets.manage', 'intelligence.read']);
      expect(guard.canActivate(contextWith(staff(['intelligence.read'])))).toBe(true);
      expect(guard.canActivate(contextWith(staff(['markets.manage'])))).toBe(true);
    });

    it('fails with none of them, naming the choices', () => {
      requiring(undefined, ['markets.manage', 'intelligence.read']);
      expect(() => guard.canActivate(contextWith(staff(['orders.read'])))).toThrow(ForbiddenException);
      expect(() => guard.canActivate(contextWith(staff(['orders.read'])))).toThrow(
        'Missing permission(s): one of markets.manage, intelligence.read',
      );
    });

    it('rejects an unauthenticated request', () => {
      requiring(undefined, ['markets.manage']);
      expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
    });

    it('an empty list is no requirement', () => {
      requiring(undefined, []);
      expect(guard.canActivate(contextWith(undefined))).toBe(true);
      expect(guard.canActivate(contextWith(staff([])))).toBe(true);
    });

    it('lets super_admin through', () => {
      requiring(undefined, ['markets.manage', 'intelligence.read']);
      expect(guard.canActivate(contextWith({ roles: ['super_admin'], permissions: [] }))).toBe(true);
    });

    it('with both decorators, both must hold', () => {
      requiring(['reports.read'], ['markets.manage', 'intelligence.read']);
      expect(guard.canActivate(contextWith(staff(['reports.read', 'intelligence.read'])))).toBe(true);
      expect(() => guard.canActivate(contextWith(staff(['reports.read'])))).toThrow(/one of markets.manage/);
      expect(() => guard.canActivate(contextWith(staff(['intelligence.read'])))).toThrow(/reports.read/);
      expect(guard.canActivate(contextWith({ roles: ['super_admin'], permissions: [] }))).toBe(true);
    });
  });
});
