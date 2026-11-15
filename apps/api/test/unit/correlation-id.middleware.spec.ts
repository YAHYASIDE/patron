import { trace } from '@opentelemetry/api';
import {
  CORRELATION_HEADER,
  CorrelationIdMiddleware,
} from '../../src/common/context/correlation-id.middleware';
import { RequestContextStore } from '../../src/common/context/request-context';

describe('CorrelationIdMiddleware', () => {
  let middleware: CorrelationIdMiddleware;
  let res: any;

  beforeEach(() => {
    middleware = new CorrelationIdMiddleware();
    res = { setHeader: jest.fn() };
    // Default: no active span, so the header/uuid fallbacks apply.
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  const makeReq = (over: any = {}) =>
    ({ headers: {}, ip: '9.9.9.9', originalUrl: '/orders?x=1', ...over } as any);

  it('honours an inbound correlation header when no trace is active', () => {
    const next = jest.fn();
    middleware.use(makeReq({ headers: { [CORRELATION_HEADER]: 'inbound-abc' } }), res, next);

    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'inbound-abc');
    expect(next).toHaveBeenCalled();
  });

  it('takes the first value when the inbound header arrives as an array', () => {
    middleware.use(
      makeReq({ headers: { [CORRELATION_HEADER]: ['first', 'second'] } }),
      res,
      jest.fn(),
    );
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'first');
  });

  it('generates a UUID when neither a trace nor an inbound header exists', () => {
    middleware.use(makeReq(), res, jest.fn());
    const [, value] = res.setHeader.mock.calls[0];
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('prefers the active trace id over any inbound header', () => {
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({ traceId: 'trace-xyz' }),
    } as any);

    middleware.use(makeReq({ headers: { [CORRELATION_HEADER]: 'inbound-abc' } }), res, jest.fn());
    expect(res.setHeader).toHaveBeenCalledWith(CORRELATION_HEADER, 'trace-xyz');
  });

  it('exposes the correlation id, ip and path to downstream code via the store', () => {
    let seen: any;
    const next = jest.fn(() => {
      seen = RequestContextStore.get();
    });

    middleware.use(
      makeReq({ headers: { [CORRELATION_HEADER]: 'ctx-1' }, ip: '1.1.1.1', originalUrl: '/p' }),
      res,
      next,
    );

    expect(seen).toEqual({ correlationId: 'ctx-1', ip: '1.1.1.1', path: '/p' });
  });
});
