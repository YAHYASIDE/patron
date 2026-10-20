import nock from 'nock';
import { FazerCardsAdapter } from '../../src/modules/providers/adapters/fazercards.adapter';
import { FoxReloadAdapter } from '../../src/modules/providers/adapters/foxreload.adapter';
import { ProviderCredentials } from '../../src/modules/providers/adapters/provider-adapter.interface';

const BASE = 'https://provider.test';
const creds: ProviderCredentials = { baseUrl: BASE, apiKey: 'k', apiSecret: 's', timeoutMs: 500 };
const req = {
  idempotencyKey: 'idem-1', providerSku: 'SKU_A', quantity: 1, inputs: { player_id: '12345678' }, reference: 'item-1',
};

describe('Provider adapters under failure', () => {
  afterEach(() => nock.cleanAll());

  describe('FazerCards', () => {
    const adapter = new FazerCardsAdapter();

    it('maps a completed response to DELIVERED with its codes', async () => {
      nock(BASE).post('/orders').reply(200, { order_id: 'ext-1', status: 'completed', codes: ['CODE-1'] });

      const result = await adapter.fulfil(req, creds);
      expect(result.status).toBe('DELIVERED');
      expect(result).toMatchObject({ results: [{ resultType: 'code', value: 'CODE-1' }] });
    });

    it('treats a 500 as retryable', async () => {
      nock(BASE).post('/orders').reply(500, { message: 'boom' });

      const result = await adapter.fulfil(req, creds);
      expect(result).toMatchObject({ status: 'FAILED', retryable: true });
    });

    it('treats a 400 as non-retryable — retrying will fail identically', async () => {
      nock(BASE).post('/orders').reply(400, { error_code: 'bad_request' });

      const result = await adapter.fulfil(req, creds);
      expect(result).toMatchObject({ status: 'FAILED', retryable: false });
    });

    it('treats a rate limit as retryable', async () => {
      nock(BASE).post('/orders').reply(429, {});
      const result = await adapter.fulfil(req, creds);
      expect(result).toMatchObject({ status: 'FAILED', retryable: true });
    });

    it('times out rather than holding a worker slot forever', async () => {
      nock(BASE).post('/orders').delay(2000).reply(200, {});

      const result = await adapter.fulfil(req, creds);
      expect(result).toMatchObject({ status: 'FAILED', errorCode: 'transport_error', retryable: true });
    });

    it('survives a socket hang-up', async () => {
      nock(BASE).post('/orders').replyWithError({ code: 'ECONNRESET' });

      const result = await adapter.fulfil(req, creds);
      expect(result.status).toBe('FAILED');
    });

    it('does not choke on a malformed body', async () => {
      nock(BASE).post('/orders').reply(200, 'not json at all');

      const result = await adapter.fulfil(req, creds);
      expect(result.status).toBe('FAILED');
    });

    it('forwards our idempotency key so a retry is not a second purchase', async () => {
      let sent: any;
      nock(BASE).post('/orders', (body) => { sent = body; return true; })
        .reply(200, { order_id: 'ext-1', status: 'completed', codes: ['C'] });

      await adapter.fulfil(req, creds);
      expect(sent.idempotency_key).toBe('idem-1');
    });

    it('rejects a webhook with a forged signature', () => {
      expect(adapter.verifyWebhook('{"a":1}', { 'x-fazer-signature': 'deadbeef' }, creds)).toBe(false);
    });
  });

  describe('FoxReload', () => {
    const adapter = new FoxReloadAdapter();

    it('maps status_code 1 to DELIVERED', async () => {
      nock(BASE).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 1, pin: 'PIN-1' });

      const result = await adapter.fulfil(req, creds);
      expect(result.status).toBe('DELIVERED');
    });

    it('maps status_code 2 to PENDING so the engine polls rather than retries', async () => {
      nock(BASE).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 2 });

      const result = await adapter.fulfil(req, creds);
      expect(result.status).toBe('PENDING');
    });

    it('marks status_code 3 retryable and other codes permanent', async () => {
      nock(BASE).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 3 });
      expect(await adapter.fulfil(req, creds)).toMatchObject({ retryable: true });

      nock(BASE).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 9 });
      expect(await adapter.fulfil(req, creds)).toMatchObject({ retryable: false });
    });

    it('signs the request body', async () => {
      let headers: any;
      nock(BASE).post('/transactions').reply(function () {
        headers = this.req.headers;
        return [200, { txn_id: 'tx1', status_code: 1, pin: 'P' }];
      });

      await adapter.fulfil(req, creds);
      expect(headers['x-signature']).toBeDefined();
    });
  });
});
