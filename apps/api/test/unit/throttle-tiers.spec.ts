import { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { optInTier } from '../../src/common/guards/throttle-tiers';

class Plain {
  browse() {}
  @Throttle({ expensive: { limit: 5, ttl: 60_000 } })
  report() {}
}

@Throttle({ expensive: { limit: 5, ttl: 60_000 } })
class Heavy {
  any() {}
}

const ctx = (cls: { prototype: object }, method: string) =>
  ({
    getHandler: () => (cls.prototype as Record<string, unknown>)[method],
    getClass: () => cls,
  }) as unknown as ExecutionContext;

describe('optInTier', () => {
  const skipExpensive = optInTier('expensive');

  it('skips a named tier on routes that did not ask for it', () => {
    expect(skipExpensive(ctx(Plain, 'browse'))).toBe(true);
  });

  it('applies it where the route opts in', () => {
    expect(skipExpensive(ctx(Plain, 'report'))).toBe(false);
  });

  it('applies it to every route of a controller that opts in', () => {
    expect(skipExpensive(ctx(Heavy, 'any'))).toBe(false);
  });

  it('is per tier: opting into one tier does not enable another', () => {
    expect(optInTier('strict')(ctx(Plain, 'report'))).toBe(true);
  });
});
