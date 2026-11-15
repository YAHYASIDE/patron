import { Reflector } from '@nestjs/core';
import { Public, IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';

describe('Public decorator', () => {
  it('exposes the metadata key the guard reads', () => {
    expect(IS_PUBLIC_KEY).toBe('isPublic');
  });

  it('stamps isPublic=true onto the decorated handler', () => {
    class Controller {
      @Public()
      open() {}
    }

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, Controller.prototype.open)).toBe(true);
  });

  it('leaves undecorated handlers without the flag', () => {
    class Controller {
      closed() {}
    }

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, Controller.prototype.closed)).toBeUndefined();
  });

  it('can also decorate a class', () => {
    @Public()
    class OpenController {}

    const reflector = new Reflector();
    expect(reflector.get(IS_PUBLIC_KEY, OpenController)).toBe(true);
  });
});
