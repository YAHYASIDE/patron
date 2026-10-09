import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';

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

  const requiring = (permissions: string[] | undefined) =>
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(permissions);

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
});
