import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';

const context = () =>
  ({
    getHandler: () => 'handler',
    getClass: () => 'class',
  }) as any;

describe('JwtAuthGuard', () => {
  let reflector: Reflector;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new JwtAuthGuard(reflector);
  });

  it('bypasses authentication for @Public() routes without invoking passport', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    // Spy on the parent AuthGuard.canActivate to prove it is NOT called.
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
    const superSpy = jest.spyOn(parent, 'canActivate').mockReturnValue(true as any);

    expect(guard.canActivate(context())).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, ['handler', 'class']);
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('delegates to the passport AuthGuard for a protected route', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
    const superSpy = jest.spyOn(parent, 'canActivate').mockReturnValue('super-result' as any);

    const ctx = context();
    expect(guard.canActivate(ctx)).toBe('super-result');
    expect(superSpy).toHaveBeenCalledWith(ctx);
  });

  it('treats an undefined metadata value as non-public and delegates', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined as any);
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(guard));
    const superSpy = jest.spyOn(parent, 'canActivate').mockReturnValue(true as any);

    void guard.canActivate(context());
    expect(superSpy).toHaveBeenCalled();
  });
});
