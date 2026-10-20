import * as crypto from 'crypto';
import { FazerCardsAdapter } from '../../src/modules/providers/adapters/fazercards.adapter';
import { ProviderCredentials, FulfilRequest } from '../../src/modules/providers/adapters/provider-adapter.interface';

const creds: ProviderCredentials = {
  baseUrl: 'https://api.fazer',
  apiKey: 'pk',
  apiSecret: 'sk',
  timeoutMs: 5000,
};

const req: FulfilRequest = {
  idempotencyKey: 'idem-1',
  providerSku: 'PROD_1',
  quantity: 1,
  inputs: { email: 'a@b.c' },
  reference: 'item-1',
};

const resp = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: () => Promise.resolve(JSON.stringify(body)),
});

describe('FazerCardsAdapter', () => {
  let adapter: FazerCardsAdapter;

  beforeEach(() => {
    adapter = new FazerCardsAdapter();
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
  });

  describe('fulfil', () => {
    it('sends a bearer-authorised, idempotent order and maps delivered codes', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp({ order_id: 'O1', status: 'completed', codes: ['C1', 'C2'] })) as any;

      const out = await adapter.fulfil(req, creds);

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.fazer/orders');
      expect(opts.headers.authorization).toBe('Bearer pk');
      const body = JSON.parse(opts.body);
      expect(body).toEqual({
        product_code: 'PROD_1',
        quantity: 1,
        reference: 'item-1',
        idempotency_key: 'idem-1',
        fields: { email: 'a@b.c' },
      });
      expect(out).toMatchObject({
        status: 'DELIVERED',
        providerRef: 'O1',
        results: [
          { resultType: 'code', value: 'C1' },
          { resultType: 'code', value: 'C2' },
        ],
      });
    });

    it('maps completed with no codes to an empty results array', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ order_id: 'O2', status: 'completed' })) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({ status: 'DELIVERED', results: [] });
    });

    it('maps pending and processing to PENDING', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ order_id: 'O3', status: 'pending' })) as any;
      expect(await adapter.fulfil(req, creds)).toMatchObject({ status: 'PENDING', providerRef: 'O3' });

      global.fetch = jest.fn().mockResolvedValue(resp({ order_id: 'O4', status: 'processing' })) as any;
      expect(await adapter.fulfil(req, creds)).toMatchObject({ status: 'PENDING', providerRef: 'O4' });
    });

    it('marks insufficient_balance and temporary_failure as retryable', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(resp({ order_id: 'O5', status: 'failed', error_code: 'insufficient_balance' })) as any;
      expect(await adapter.fulfil(req, creds)).toMatchObject({ retryable: true, errorCode: 'insufficient_balance' });

      global.fetch = jest
        .fn()
        .mockResolvedValue(resp({ order_id: 'O6', status: 'failed', error_code: 'temporary_failure' })) as any;
      expect(await adapter.fulfil(req, creds)).toMatchObject({ retryable: true });
    });

    it('marks a business failure like out_of_stock as non-retryable', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(
          resp({ order_id: 'O7', status: 'rejected', error_code: 'out_of_stock', message: 'gone' }),
        ) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({
        status: 'FAILED',
        errorCode: 'out_of_stock',
        errorMessage: 'gone',
        retryable: false,
      });
    });

    it('defaults the error code and message when the provider gives neither', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ order_id: 'O8', status: 'failed' })) as any;
      const out = await adapter.fulfil(req, creds);
      expect(out).toMatchObject({
        status: 'FAILED',
        errorCode: 'unknown',
        errorMessage: 'Provider rejected the order',
      });
    });

    it('maps an http error to an http_<status> transport failure', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({}, 502)) as any;
      const out: any = await adapter.fulfil(req, creds);
      expect(out.errorCode).toBe('http_502');
      expect(out.retryable).toBe(true);
    });

    it('maps a network failure to a retryable transport error', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ETIMEDOUT')) as any;
      const out: any = await adapter.fulfil(req, creds);
      expect(out.errorCode).toBe('transport_error');
      expect(out.retryable).toBe(true);
    });
  });

  describe('checkStatus', () => {
    it('polls the order by ref via GET', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ order_id: 'O1', status: 'completed', codes: [] })) as any;
      await adapter.checkStatus('O1', creds);
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.fazer/orders/O1');
      expect(opts.method).toBe('GET');
    });

    it('returns a transport failure when the poll throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
      expect((await adapter.checkStatus('O1', creds)).status).toBe('FAILED');
    });
  });

  describe('getBalance', () => {
    it('coerces the balance to a number', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ balance: '42', currency: 'USD' })) as any;
      expect(await adapter.getBalance(creds)).toEqual({ balance: 42, currency: 'USD' });
    });
  });

  describe('healthCheck', () => {
    it('is true when the ping succeeds', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({ ok: 1 })) as any;
      expect(await adapter.healthCheck(creds)).toBe(true);
    });

    it('is false when the ping errors', async () => {
      global.fetch = jest.fn().mockResolvedValue(resp({}, 500)) as any;
      expect(await adapter.healthCheck(creds)).toBe(false);
    });
  });

  describe('verifyWebhook', () => {
    const rawBody = '{"order_id":"O1"}';
    const sign = (secret: string) => crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    it('accepts a correctly signed body', () => {
      expect(adapter.verifyWebhook(rawBody, { 'x-fazer-signature': sign('sk') }, creds)).toBe(true);
    });

    it('rejects when the signature header is absent', () => {
      expect(adapter.verifyWebhook(rawBody, {}, creds)).toBe(false);
    });

    it('rejects when no api secret is configured', () => {
      expect(
        adapter.verifyWebhook(rawBody, { 'x-fazer-signature': sign('sk') }, { ...creds, apiSecret: undefined }),
      ).toBe(false);
    });

    it('rejects a wrong signature', () => {
      expect(adapter.verifyWebhook(rawBody, { 'x-fazer-signature': sign('nope') }, creds)).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    it('returns null without an order id or data payload', () => {
      expect(adapter.parseWebhook({ event_id: 'e1' })).toBeNull();
      expect(adapter.parseWebhook({ order_id: 'O1' })).toBeNull();
    });

    it('maps a webhook envelope, preferring event_id for the eventId', () => {
      const parsed = adapter.parseWebhook({
        event_id: 'evt-9',
        order_id: 'O1',
        data: { order_id: 'O1', status: 'completed', codes: ['C'] },
      });
      expect(parsed).toMatchObject({ eventId: 'evt-9', providerRef: 'O1' });
      expect(parsed!.outcome.status).toBe('DELIVERED');
    });
  });
});
