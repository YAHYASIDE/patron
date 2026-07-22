import * as crypto from 'crypto';
import { FoxReloadAdapter } from '../../src/modules/providers/adapters/foxreload.adapter';
import { ProviderCredentials, FulfilRequest } from '../../src/modules/providers/adapters/provider-adapter.interface';

const creds: ProviderCredentials = {
  baseUrl: 'https://api.fox',
  apiKey: 'pk',
  apiSecret: 'sk',
  timeoutMs: 5000,
};

const req: FulfilRequest = {
  idempotencyKey: 'idem-1',
  providerSku: 'SKU_A',
  quantity: 2,
  inputs: { player_id: '42' },
  reference: 'item-1',
};

const resp = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

describe('FoxReloadAdapter', () => {
  let adapter: FoxReloadAdapter;

  beforeEach(() => {
    adapter = new FoxReloadAdapter();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
  });

  describe('fulfil', () => {
    it('signs the request and maps a delivered code + serial', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp({ txn_id: 'T1', status_code: 1, pin: 'PIN-9', serial: 'SER-1' })) as any;

      const out = await adapter.fulfil(req, creds);

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.fox/transactions');
      expect(opts.headers['x-api-key']).toBe('pk');
      expect(typeof opts.headers['x-signature']).toBe('string');
      // request body shape
      const body = JSON.parse(opts.body);
      expect(body).toEqual({ sku: 'SKU_A', qty: 2, client_ref: 'item-1', request_id: 'idem-1', params: { player_id: '42' } });

      expect(out).toMatchObject({
        status: 'DELIVERED',
        providerRef: 'T1',
        results: [
          { resultType: 'code', value: 'PIN-9' },
          { resultType: 'serial', value: 'SER-1' },
        ],
      });
    });

    it('falls back to a receipt result when success carries no pin or serial', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ txn_id: 'T2', status_code: 1 })) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({ status: 'DELIVERED', results: [{ resultType: 'receipt', value: 'T2' }] });
    });

    it('maps status_code 2 to PENDING', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ txn_id: 'T3', status_code: 2 })) as any;
      expect(await adapter.fulfil(req, creds)).toMatchObject({ status: 'PENDING', providerRef: 'T3' });
    });

    it('maps status_code 3 to a retryable failure', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp({ txn_id: 'T4', status_code: 3, status_message: 'busy' })) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({ status: 'FAILED', errorCode: '3', errorMessage: 'busy', retryable: true });
    });

    it('maps any other status_code to a non-retryable failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ txn_id: 'T5', status_code: 9 })) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({
        status: 'FAILED',
        errorCode: '9',
        errorMessage: 'Transaction failed',
        retryable: false,
      });
    });

    it('maps an http error into an http_<status> transport failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ error: 'server' }, 500)) as any;
      const out: any = await adapter.fulfil(req, creds);
      expect(out.status).toBe('FAILED');
      expect(out.errorCode).toBe('http_500');
      expect(out.retryable).toBe(true);
    });

    it('maps a network failure into a retryable transport error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('socket hang up')) as any;
      const out: any = await adapter.fulfil(req, creds);
      expect(out.status).toBe('FAILED');
      expect(out.errorCode).toBe('transport_error');
      expect(out.retryable).toBe(true);
    });
  });

  describe('checkStatus', () => {
    it('polls via GET and maps the outcome', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ txn_id: 'T1', status_code: 1, pin: 'P' })) as any;
      const out = await adapter.checkStatus('T1', creds);
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.fox/transactions/T1');
      expect(opts.method).toBe('GET');
      expect(out.status).toBe('DELIVERED');
    });

    it('returns a transport failure when the poll errors', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
      const out: any = await adapter.checkStatus('T1', creds);
      expect(out.status).toBe('FAILED');
    });
  });

  describe('getBalance', () => {
    it('numerically coerces the credit field', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ data: { credit: '123.45', currency: 'USD' } })) as any;
      expect(await adapter.getBalance(creds)).toEqual({ balance: 123.45, currency: 'USD' });
    });
  });

  describe('healthCheck', () => {
    it('is true when the probe succeeds', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ ok: 1 })) as any;
      expect(await adapter.healthCheck(creds)).toBe(true);
    });

    it('is false when the probe errors', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({}, 500)) as any;
      expect(await adapter.healthCheck(creds)).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    const rawBody = '{"transaction":{"txn_id":"T1","status_code":1}}';
    const sign = (secret: string) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    it('accepts a correctly signed body', () => {
      expect(adapter.verifyWebhook(rawBody, { 'x-signature': sign('sk') }, creds)).toBe(true);
    });

    it('rejects when the signature header is missing', () => {
      expect(adapter.verifyWebhook(rawBody, {}, creds)).toBe(false);
    });

    it('rejects a signature computed with the wrong secret', () => {
      expect(adapter.verifyWebhook(rawBody, { 'x-signature': sign('wrong') }, creds)).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('returns null when there is no transaction', () => {
      expect(adapter.parseWebhook({ id: 'e1' })).toBeNull();
    });

    it('maps a transaction envelope to an outcome, defaulting the eventId to the txn id', () => {
      const parsed = adapter.parseWebhook({ transaction: { txn_id: 'T1', status_code: 1, pin: 'P' } });
      expect(parsed).toMatchObject({ eventId: 'T1', providerRef: 'T1' });
      expect(parsed!.outcome.status).toBe('DELIVERED');
    });
  });
});
