import { firstValueFrom, of, throwError } from 'rxjs';
import { MetricsInterceptor } from '../../src/common/metrics/metrics.interceptor';

describe('MetricsInterceptor', () => {
  let stop: jest.Mock;
  let metrics: any;
  let interceptor: MetricsInterceptor;

  beforeEach(() => {
    stop = jest.fn();
    metrics = { httpDuration: { startTimer: jest.fn(() => stop) } };
    interceptor = new MetricsInterceptor(metrics);
  });

  const makeCtx = (over: { type?: string; req?: any; res?: any } = {}) => {
    const req = { method: 'GET', route: { path: '/orders/:id' }, ...over.req };
    const res = { statusCode: 200, ...over.res };
    return {
      getType: () => over.type ?? 'http',
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as any;
  };

  const handlerOf = (obs: any) => ({ handle: () => obs } as any);

  it('bypasses non-http contexts without starting a timer', async () => {
    const next = handlerOf(of('rpc-result'));
    const result = interceptor.intercept(makeCtx({ type: 'rpc' }), next);
    await expect(firstValueFrom(result)).resolves.toBe('rpc-result');
    expect(metrics.httpDuration.startTimer).not.toHaveBeenCalled();
  });

  it('records method, route pattern and status on a successful response', async () => {
    const next = handlerOf(of('ok'));
    await firstValueFrom(interceptor.intercept(makeCtx(), next));
    expect(stop).toHaveBeenCalledWith({ method: 'GET', route: '/orders/:id', status: '200' });
  });

  it('labels unmatched routes rather than leaking a raw URL', async () => {
    const ctx = makeCtx({ req: { method: 'POST', route: undefined } });
    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))));
    expect(stop).toHaveBeenCalledWith({ method: 'POST', route: 'unmatched', status: '200' });
  });

  it('records the error status when the handler throws', async () => {
    const boom = Object.assign(new Error('bad'), { status: 403 });
    const result = interceptor.intercept(makeCtx(), handlerOf(throwError(() => boom)));
    await expect(firstValueFrom(result)).rejects.toBe(boom);
    expect(stop).toHaveBeenCalledWith({ method: 'GET', route: '/orders/:id', status: '403' });
  });

  it('defaults an error with no status to 500', async () => {
    const boom = new Error('opaque');
    const result = interceptor.intercept(makeCtx(), handlerOf(throwError(() => boom)));
    await expect(firstValueFrom(result)).rejects.toBe(boom);
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({ status: '500' }));
  });
});
