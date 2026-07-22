import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser, AuthUser } from '../../src/common/decorators/current-user.decorator';

/**
 * createParamDecorator hides its factory behind route-args metadata. Apply the
 * decorator to a throwaway method and pull the factory back out so it can be
 * invoked with a mock ExecutionContext.
 */
function factoryOf(decorator: (...a: any[]) => ParameterDecorator, arg?: any) {
  class Probe {
    handler(@decorator(arg) _value: unknown) {}
  }
  const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
  return meta[Object.keys(meta)[0]].factory as (field: keyof AuthUser | undefined, ctx: any) => any;
}

const ctxWith = (user: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;

const user: AuthUser = { id: 'u1', email: 'a@b.c', roles: ['admin'], permissions: ['orders.read'] };

describe('CurrentUser decorator', () => {
  it('returns the whole user object when no field is given', () => {
    const factory = factoryOf(CurrentUser);
    expect(factory(undefined, ctxWith(user))).toBe(user);
  });

  it('extracts a single field when one is requested', () => {
    const factory = factoryOf(CurrentUser, 'id');
    expect(factory('id', ctxWith(user))).toBe('u1');
  });

  it('extracts the email field', () => {
    const factory = factoryOf(CurrentUser, 'email');
    expect(factory('email', ctxWith(user))).toBe('a@b.c');
  });

  it('returns undefined for a field when the request has no user', () => {
    const factory = factoryOf(CurrentUser, 'id');
    expect(factory('id', ctxWith(undefined))).toBeUndefined();
  });

  it('returns undefined (not throwing) for the whole-user case with no user', () => {
    const factory = factoryOf(CurrentUser);
    expect(factory(undefined, ctxWith(undefined))).toBeUndefined();
  });
});
