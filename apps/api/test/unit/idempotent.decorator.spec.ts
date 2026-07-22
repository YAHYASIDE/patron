import { Reflector } from '@nestjs/core';
import { IDEMPOTENT_KEY, Idempotent } from '../../src/common/idempotency/idempotent.decorator';

describe('Idempotent decorator', () => {
  it('exposes the stable metadata key used by the interceptor', () => {
    expect(IDEMPOTENT_KEY).toBe('idempotent');
  });

  it('marks the decorated handler so the reflector reads `true`', () => {
    class TestController {
      @Idempotent()
      createOrder() {
        return 'ok';
      }

      plainHandler() {
        return 'ok';
      }
    }

    const reflector = new Reflector();
    expect(reflector.get(IDEMPOTENT_KEY, TestController.prototype.createOrder)).toBe(true);
    // Undecorated handlers carry no metadata, so the interceptor bypasses them.
    expect(reflector.get(IDEMPOTENT_KEY, TestController.prototype.plainHandler)).toBeUndefined();
  });
});
