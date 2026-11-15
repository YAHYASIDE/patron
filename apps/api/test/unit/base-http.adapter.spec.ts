import { BaseHttpAdapter, ProviderHttpError } from '../../src/modules/providers/adapters/base-http.adapter';
import { ProviderCredentials } from '../../src/modules/providers/adapters/provider-adapter.interface';

class TestAdapter extends BaseHttpAdapter {
  callRequest<T>(creds: ProviderCredentials, path: string, init?: any) {
    return this.request<T>(creds, path, init);
  }
  callTransport(err: unknown) {
    return this.toTransportFailure(err);
  }
  callRedact(p: Record<string, unknown>) {
    return this.redact(p);
  }
}

const creds: ProviderCredentials = { baseUrl: 'https://api.test/', apiKey: 'k', timeoutMs: 5000 };

const okResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)),
});

describe('BaseHttpAdapter', () => {
  let adapter: TestAdapter;

  beforeEach(() => {
    adapter = new TestAdapter();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
  });

  describe('request', () => {
    it('builds the url without double slashes and defaults to a JSON POST', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({ ok: 1 })) as any;

      const res = await adapter.callRequest(creds, '/orders', { body: { a: 1 } });

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.test/orders');
      expect(opts.method).toBe('POST');
      expect(opts.headers['content-type']).toBe('application/json');
      expect(opts.body).toBe(JSON.stringify({ a: 1 }));
      expect(res).toEqual({ ok: 1 });
    });

    it('sends no body on a GET and merges custom headers', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({ ok: 1 })) as any;

      await adapter.callRequest(creds, 'ping', { method: 'GET', headers: { 'x-api-key': 'abc' } });

      const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(opts.method).toBe('GET');
      expect(opts.body).toBeUndefined();
      expect(opts.headers['x-api-key']).toBe('abc');
    });

    it('returns null for an empty response body', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse(undefined)) as any;
      expect(await adapter.callRequest(creds, '/x')).toBeNull();
    });

    it('wraps a non-JSON success body under a raw key', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('not json') }) as any;
      expect(await adapter.callRequest(creds, '/x')).toEqual({ raw: 'not json' });
    });

    it('throws a retryable ProviderHttpError on 5xx', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({ msg: 'boom' }, 503)) as any;
      const err: any = await adapter.callRequest(creds, '/x').catch((e: any) => e);
      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.status).toBe(503);
      expect(err.retryable).toBe(true);
      expect(err.body).toEqual({ msg: 'boom' });
    });

    it('treats 429 as retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({}, 429)) as any;
      const err: any = await adapter.callRequest(creds, '/x').catch((e: any) => e);
      expect(err.retryable).toBe(true);
    });

    it('treats a 4xx as non-retryable', async () => {
      global.fetch = jest.fn().mockResolvedValue(okResponse({}, 400)) as any;
      const err: any = await adapter.callRequest(creds, '/x').catch((e: any) => e);
      expect(err.status).toBe(400);
      expect(err.retryable).toBe(false);
    });

    it('maps an abort into a retryable timeout error with a null status', async () => {
      const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
      global.fetch = jest.fn().mockRejectedValue(abort) as any;

      const err: any = await adapter.callRequest(creds, '/x').catch((e: any) => e);
      expect(err).toBeInstanceOf(ProviderHttpError);
      expect(err.message).toMatch(/Timed out after 5000ms/);
      expect(err.status).toBeNull();
      expect(err.retryable).toBe(true);
    });

    it('maps a generic network failure to a retryable transport error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET')) as any;
      const err: any = await adapter.callRequest(creds, '/x').catch((e: any) => e);
      expect(err.message).toBe('ECONNRESET');
      expect(err.status).toBeNull();
      expect(err.retryable).toBe(true);
    });
  });

  describe('toTransportFailure', () => {
    it('maps an http error to an http_<status> code', () => {
      const out = adapter.callTransport(new ProviderHttpError('bad', 500, { x: 1 }, true));
      expect(out).toEqual({
        status: 'FAILED',
        errorCode: 'http_500',
        errorMessage: 'bad',
        retryable: true,
        raw: { x: 1 },
      });
    });

    it('maps a statusless error to a transport_error code', () => {
      const out = adapter.callTransport(new ProviderHttpError('down', null, null, false));
      expect(out.errorCode).toBe('transport_error');
      expect(out.retryable).toBe(false);
      expect(out.raw).toBeNull();
    });
  });

  describe('redact', () => {
    it('masks any key whose name contains a secret token, case-insensitively', () => {
      const out = adapter.callRedact({
        apiKey: 'k',
        Authorization: 'Bearer t',
        signature: 'sig',
        product: 'GAME',
      });
      expect(out.apiKey).toBe('[REDACTED]');
      expect(out.Authorization).toBe('[REDACTED]');
      expect(out.signature).toBe('[REDACTED]');
      expect(out.product).toBe('GAME');
    });
  });
});
