import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of, throwError } from 'rxjs';
import { IdempotencyInterceptor } from '../../src/common/idempotency/idempotency.interceptor';

const KEY = 'a-valid-idempotency-key';

describe('IdempotencyInterceptor', () => {
  let idempotency: any;
  let reflector: any;
  let metrics: any;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    idempotency = {
      hashRequest: jest.fn().mockReturnValue('hash'),
      claim: jest.fn().mockResolvedValue(null),
      complete: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    reflector = { get: jest.fn().mockReturnValue(true) };
    metrics = { idempotencyReplays: { inc: jest.fn() } };
    interceptor = new IdempotencyInterceptor(idempotency, reflector, metrics);
  });

  const makeCtx = (over: Partial<any> = {}) => {
    const req = {
      headers: { 'idempotency-key': KEY },
      body: { quoteId: 'q1' },
      method: 'POST',
      route: { path: '/checkout/orders' },
      url: '/checkout/orders',
      user: { id: 'u1' },
      ...over.req,
    };
    const res = { statusCode: 'statusCode' in over ? over.statusCode : 201 };
    return {
      getHandler: () => (over.handler ?? (() => undefined)),
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any;
  };

  const handlerOf = (obs: any) => ({ handle: () => obs } as any);

  it('bypasses entirely when the handler is not marked idempotent', async () => {
    reflector.get.mockReturnValue(false);
    const next = handlerOf(of('passthrough'));
    const result = interceptor.intercept(makeCtx(), next);
    await expect(firstValueFrom(result)).resolves.toBe('passthrough');
    expect(idempotency.claim).not.toHaveBeenCalled();
  });

  it('rejects a request with no Idempotency-Key header', () => {
    const ctx = makeCtx({ req: { headers: {} } });
    expect(() => interceptor.intercept(ctx, handlerOf(of('x')))).toThrow(BadRequestException);
  });

  it('rejects a key that is too short', () => {
    const ctx = makeCtx({ req: { headers: { 'idempotency-key': 'short' } } });
    expect(() => interceptor.intercept(ctx, handlerOf(of('x')))).toThrow(/8–200/);
  });

  it('rejects a key that is too long', () => {
    const ctx = makeCtx({ req: { headers: { 'idempotency-key': 'x'.repeat(201) } } });
    expect(() => interceptor.intercept(ctx, handlerOf(of('x')))).toThrow(/8–200/);
  });

  it('replays the stored response and counts a metric when a claim returns one', async () => {
    idempotency.claim.mockResolvedValue({ replayed: true, statusCode: 201, body: { id: 'o1' } });
    const next = handlerOf(of('SHOULD_NOT_RUN'));
    const result = await firstValueFrom(interceptor.intercept(makeCtx(), next));
    expect(result).toEqual({ id: 'o1' });
    expect(metrics.idempotencyReplays.inc).toHaveBeenCalledWith({ endpoint: 'POST /checkout/orders' });
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('runs the handler and completes the record on success', async () => {
    const body = { id: 'o1', total: new Prisma.Decimal('12.50') };
    const result = await firstValueFrom(interceptor.intercept(makeCtx(), handlerOf(of(body))));
    expect(result).toBe(body);
    expect(idempotency.claim).toHaveBeenCalledWith(KEY, 'POST /checkout/orders', 'hash', 'u1');
    // serialiseMoney turns the Decimal into a string before persistence
    expect(idempotency.complete).toHaveBeenCalledWith(KEY, 201, { id: 'o1', total: '12.5' });
  });

  it('defaults the stored status to 200 when the response has none', async () => {
    const ctx = makeCtx({ statusCode: undefined });
    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of({ ok: true }))));
    expect(idempotency.complete).toHaveBeenCalledWith(KEY, 200, { ok: true });
  });

  it('falls back to req.url for the endpoint when there is no matched route', async () => {
    const ctx = makeCtx({ req: { headers: { 'idempotency-key': KEY }, route: undefined, url: '/raw', method: 'POST', user: undefined } });
    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))));
    expect(idempotency.claim).toHaveBeenCalledWith(KEY, 'POST /raw', 'hash', undefined);
  });

  it('releases the claim and rethrows when the handler errors', async () => {
    const boom = new Error('handler failed');
    const next = handlerOf(throwError(() => boom));
    await expect(firstValueFrom(interceptor.intercept(makeCtx(), next))).rejects.toBe(boom);
    expect(idempotency.release).toHaveBeenCalledWith(KEY);
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
