import { trace } from '@opentelemetry/api';
import { loggerConfig } from '../../src/common/logging/logger.config';
import { RequestContextStore } from '../../src/common/context/request-context';

// Reach into the pinoHttp options the way nestjs-pino would.
const opts = (isProduction: boolean) => (loggerConfig(isProduction) as any).pinoHttp;

describe('loggerConfig', () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLevel;
    jest.restoreAllMocks();
  });

  describe('level', () => {
    it('defaults to info in production and debug otherwise', () => {
      delete process.env.LOG_LEVEL;
      expect(opts(true).level).toBe('info');
      expect(opts(false).level).toBe('debug');
    });

    it('lets LOG_LEVEL override the default', () => {
      process.env.LOG_LEVEL = 'trace';
      expect(opts(true).level).toBe('trace');
    });
  });

  describe('genReqId', () => {
    it('returns the active correlation id', () => {
      const id = RequestContextStore.run({ correlationId: 'corr-9' }, () =>
        opts(false).genReqId(),
      );
      expect(id).toBe('corr-9');
    });

    it('falls back to a UUID when the correlation id is empty', () => {
      const id = RequestContextStore.run({ correlationId: '' }, () => opts(false).genReqId());
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('mixin', () => {
    it('adds request-context fields when a context is active', () => {
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
      const fields = RequestContextStore.run(
        { correlationId: 'c1', userId: 'u1', jobId: 'j1' },
        () => opts(false).mixin(),
      );
      expect(fields).toEqual({ correlationId: 'c1', userId: 'u1', jobId: 'j1' });
    });

    it('adds trace/span ids when a span is active', () => {
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue({
        spanContext: () => ({ traceId: 't1', spanId: 's1' }),
      } as any);
      const fields = RequestContextStore.run({ correlationId: 'c1' }, () => opts(false).mixin());
      expect(fields).toMatchObject({ traceId: 't1', spanId: 's1' });
    });

    it('is empty when there is neither a context nor a span', () => {
      jest.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
      expect(opts(false).mixin()).toEqual({});
    });
  });

  describe('customLogLevel', () => {
    const level = (statusCode: number, err?: Error) =>
      opts(false).customLogLevel({} as any, { statusCode } as any, err);

    it('is error on a thrown error', () => {
      expect(level(200, new Error('x'))).toBe('error');
    });
    it('is error on a 5xx', () => {
      expect(level(503)).toBe('error');
    });
    it('is warn on a 4xx', () => {
      expect(level(404)).toBe('warn');
    });
    it('is info on a 2xx', () => {
      expect(level(200)).toBe('info');
    });
  });

  describe('autoLogging.ignore', () => {
    const ignore = (url?: string) => opts(false).autoLogging.ignore({ url } as any);

    it('ignores health and metrics scrapes, query string and all', () => {
      expect(ignore('/health')).toBe(true);
      expect(ignore('/health/ready')).toBe(true);
      expect(ignore('/metrics?format=prom')).toBe(true);
    });

    it('does not ignore business routes', () => {
      expect(ignore('/orders')).toBe(false);
    });

    it('tolerates a missing url', () => {
      expect(ignore(undefined)).toBe(false);
    });
  });

  describe('serializers', () => {
    it('projects the request down to method, url and ip', () => {
      const out = opts(false).serializers.req({
        method: 'POST',
        url: '/orders',
        remoteAddress: '2.2.2.2',
        headers: { authorization: 'secret' },
      });
      expect(out).toEqual({ method: 'POST', url: '/orders', ip: '2.2.2.2' });
    });

    it('projects the response down to its status code', () => {
      expect(opts(false).serializers.res({ statusCode: 201 } as any)).toEqual({ statusCode: 201 });
    });
  });

  describe('redaction', () => {
    it('redacts secret-bearing paths with a stable censor', () => {
      const { paths, censor } = opts(false).redact;
      expect(censor).toBe('[REDACTED]');
      expect(paths).toEqual(
        expect.arrayContaining([
          'req.headers.authorization',
          'req.body.password',
          'req.body.refreshToken',
          '*.passwordHash',
          '*.twoFaSecretEnc',
        ]),
      );
    });
  });

  describe('transport', () => {
    it('uses pino-pretty outside production and none in production', () => {
      expect(opts(false).transport).toMatchObject({ target: 'pino-pretty' });
      expect(opts(true).transport).toBeUndefined();
    });
  });
});
