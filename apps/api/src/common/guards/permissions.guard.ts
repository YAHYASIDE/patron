import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { AuthUser } from '../decorators/current-user.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    const anyOf = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, targets);
    if (!required?.length && !anyOf?.length) return true;

    const user = context.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    // super_admin bypasses the permission matrix by design
    if (user.roles.includes('super_admin')) return true;

    const missing = (required ?? []).filter((p) => !user.permissions.includes(p));
    if (missing.length) throw new ForbiddenException(`Missing permission(s): ${missing.join(', ')}`);
    if (anyOf?.length && !anyOf.some((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(`Missing permission(s): one of ${anyOf.join(', ')}`);
    }
    return true;
  }
}
