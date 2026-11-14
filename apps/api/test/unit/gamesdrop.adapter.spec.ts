import { randomUUID } from 'crypto';
import { GamesDropAdapter } from '../../src/modules/providers/adapters/gamesdrop.adapter';
import { FulfilRequest, ProviderCredentials } from '../../src/modules/providers/adapters/provider-adapter.interface';

const token = `shop-${randomUUID()}`;
const creds: ProviderCredentials = { baseUrl: 'https://partner.gamesdrop.test', apiKey: token, timeoutMs: 5000, config: { countryCode: 'MR' } };

const req = (over: Partial<FulfilRequest> = {}): FulfilRequest => ({
  idempotencyKey: 'idem-1',
  providerSku: '101',
  quantity: 1,
  inputs: { player_id: '5123456789' },
  reference: 'item-1',
  maxUnitCost: 1.0,
  ...over,
});

const resp = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(JSON.stringify(body)) });

const quote = (over: Record<string, unknown> = {}) => ({
  offerId: 101, price: 0.99, currency: 'USD', canFulfillQuantity: true, countryCompatibility: 'allowed',
  isReturnDataForCustomer: false, isRequiredGameUserId: true, isRequiredGameServerId: false, productOfferId: 77882, ...over,
});

/** Routes by path; each value is a queue of responses (last one repeats). */
function mockApi(routes: Record<string, Array<ReturnType<typeof resp> | Error>>) {
  const fn = jest.fn((url: string, ...init: unknown[]) => {
    void init;
    const path = new URL(url).pathname;
    const queue = routes[path];
    if (!queue) throw new Error(`unexpected call ${path}`);
    const next = queue.length > 1 ? queue.shift()! : queue[0];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}
const bodyOf = (fn: jest.Mock, path: string) =>
  fn.mock.calls.filter(([u]) => new URL(u as string).pathname === path).map(([, o]) => JSON.parse((o as { body: string }).body));

describe('GamesDropAdapter', () => {
  const adapter = new GamesDropAdapter();

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete global.fetch;
  });

  it('direct top-up: quotes, validates the player, buys at the quoted price with our key as transactionId', async () => {
    const fn = mockApi({
      '/api/v1/offers/find-one': [resp(quote())],
      '/api/v1/offers/check-game-data': [resp({ status: 'VALID', gameUserLogin: 'P' })],
      '/api/v1/offers/create-order': [resp({ orderId: 555, transactionId: 'idem-1', status: 'COMPLETED', isReturnDataForCustomer: false })],
    });
    const out = await adapter.fulfil(req(), creds);

    expect(out).toMatchObject({ status: 'DELIVERED', providerRef: '555', results: [{ resultType: 'message' }], raw: { unitPrice: 0.99 } });
    const opts = (fn.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(opts.headers.authorization).toBe(token); // raw shop token, no "Bearer"
    expect(bodyOf(fn, '/api/v1/offers/find-one')[0]).toEqual({ offerId: 101, quantity: 1, countryCode: 'MR' });
    expect(bodyOf(fn, '/api/v1/offers/create-order')[0]).toEqual({
      offerId: 101, price: 0.99, transactionId: 'idem-1', quantity: 1, countryCode: 'MR', productOfferId: 77882,
      customer: { gameUserId: '5123456789' },
    });
  });

  it('gift card: returns the key as an encrypted-later code, never in raw', async () => {
    const secret = `KEY-${randomUUID()}`;
    mockApi({
      '/api/v1/offers/find-one': [resp(quote({ isRequiredGameUserId: false, isReturnDataForCustomer: true }))],
      '/api/v1/offers/create-order': [resp({ orderId: 9, status: 'COMPLETED', isReturnDataForCustomer: true, key: secret })],
    });
    const out = await adapter.fulfil(req({ inputs: {} }), creds);
    expect(out).toMatchObject({ status: 'DELIVERED', results: [{ resultType: 'code', value: secret }] });
    expect(JSON.stringify(out.raw)).not.toContain(secret);
  });

  it('refuses to buy when the supplier price is above the agreed cost', async () => {
    const fn = mockApi({ '/api/v1/offers/find-one': [resp(quote({ price: 1.25 }))] });
    const out = await adapter.fulfil(req({ maxUnitCost: 1.0 }), creds);
    expect(out).toMatchObject({ status: 'FAILED', errorCode: 'price_above_cost', retryable: false });
    expect(bodyOf(fn, '/api/v1/offers/create-order')).toHaveLength(0);
  });

  it('an invalid player id stops before any purchase', async () => {
    const fn = mockApi({
      '/api/v1/offers/find-one': [resp(quote())],
      '/api/v1/offers/check-game-data': [resp({ status: 'INVALID', message: 'bad id' })],
    });
    const out = await adapter.fulfil(req(), creds);
    expect(out).toMatchObject({ status: 'FAILED', errorCode: 'invalid_player', retryable: false });
    expect(bodyOf(fn, '/api/v1/offers/create-order')).toHaveLength(0);
  });

  it('a missing player id or a non-numeric sku fails without calling GamesDrop to buy', async () => {
    mockApi({ '/api/v1/offers/find-one': [resp(quote())] });
    expect(await adapter.fulfil(req({ inputs: {} }), creds)).toMatchObject({ errorCode: 'missing_player_id', retryable: false });
    expect(await adapter.fulfil(req({ providerSku: 'PUBG-60' }), creds)).toMatchObject({ errorCode: 'bad_sku', retryable: false });
  });

  it('blocked activation country and out of stock are refused', async () => {
    mockApi({ '/api/v1/offers/find-one': [resp(quote({ countryCompatibility: 'blocked' }))] });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ errorCode: 'country_blocked', retryable: false });
    mockApi({ '/api/v1/offers/find-one': [resp(quote({ canFulfillQuantity: false }))] });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ errorCode: 'out_of_stock', retryable: true });
  });

  it('a timeout on create-order never buys twice: PENDING by transactionId, then resolved by lookup', async () => {
    const fn = mockApi({
      '/api/v1/offers/find-one': [resp(quote())],
      '/api/v1/offers/check-game-data': [resp({ status: 'VALID' })],
      '/api/v1/offers/create-order': [new Error('socket hang up')],
      '/api/v1/offers/order-status': [resp({ orderId: 777, transactionId: 'idem-1', status: 'COMPLETED', isReturnDataForCustomer: false })],
    });
    const out = await adapter.fulfil(req(), creds);
    expect(out).toMatchObject({ status: 'PENDING', providerRef: 'tx:idem-1', raw: { order_id: 'tx:idem-1' } });
    expect(bodyOf(fn, '/api/v1/offers/create-order')).toHaveLength(1);

    const later = await adapter.checkStatus('tx:idem-1', creds);
    expect(bodyOf(fn, '/api/v1/offers/order-status')[0]).toEqual({ transactionId: 'idem-1' });
    expect(later).toMatchObject({ status: 'DELIVERED', providerRef: '777' });
  });

  it('SERVICE_UNAVAILABLE with HTTP 200 on create-order is an unknown outcome too', async () => {
    mockApi({
      '/api/v1/offers/find-one': [resp(quote({ isRequiredGameUserId: false }))],
      '/api/v1/offers/create-order': [resp({ error: 'SERVICE_UNAVAILABLE' })],
    });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ status: 'PENDING', providerRef: 'tx:idem-1' });
  });

  it('a duplicate transaction returns the existing order instead of buying again', async () => {
    mockApi({
      '/api/v1/offers/find-one': [resp(quote({ isRequiredGameUserId: false }))],
      '/api/v1/offers/create-order': [resp({ error: { code: 'TRANSACTION_DUPLICATE' } }, 409)],
      '/api/v1/offers/order-status': [resp({ orderId: 42, status: 'PROCESSING' })],
    });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ status: 'PENDING', providerRef: '42' });
  });

  it('WRONG_PRICE re-quotes once and still respects the cost cap', async () => {
    const fn = mockApi({
      '/api/v1/offers/find-one': [resp(quote({ isRequiredGameUserId: false })), resp(quote({ isRequiredGameUserId: false, price: 0.95 }))],
      '/api/v1/offers/create-order': [resp({ error: 'WRONG_PRICE' }), resp({ orderId: 8, status: 'COMPLETED' })],
    });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ status: 'DELIVERED' });
    expect(bodyOf(fn, '/api/v1/offers/create-order').map((b) => b.price)).toEqual([0.99, 0.95]);

    mockApi({
      '/api/v1/offers/find-one': [resp(quote({ isRequiredGameUserId: false })), resp(quote({ isRequiredGameUserId: false, price: 3 }))],
      '/api/v1/offers/create-order': [resp({ error: 'WRONG_PRICE' })],
    });
    expect(await adapter.fulfil(req(), creds)).toMatchObject({ status: 'FAILED', errorCode: 'price_above_cost' });
  });

  it('maps canceled orders, still-processing orders and a missing key', async () => {
    mockApi({ '/api/v1/offers/order-status': [resp({ orderId: 1, status: 'CANCELED', failureReason: 'supplier out' })] });
    expect(await adapter.checkStatus('1', creds)).toMatchObject({ status: 'FAILED', retryable: false });
    mockApi({ '/api/v1/offers/order-status': [resp({ orderId: 1, status: 'SUBMITTED' })] });
    expect(await adapter.checkStatus('1', creds)).toMatchObject({ status: 'PENDING', providerRef: '1' });
    mockApi({ '/api/v1/offers/order-status': [resp({ orderId: 1, status: 'COMPLETED', isReturnDataForCustomer: true })] });
    expect(await adapter.checkStatus('1', creds)).toMatchObject({ status: 'PENDING' });
    mockApi({ '/api/v1/offers/order-status': [resp({ error: 'ORDER_NOT_FOUND' })] });
    expect(await adapter.checkStatus('tx:never', creds)).toMatchObject({ status: 'FAILED', errorCode: 'order_not_found' });
    mockApi({ '/api/v1/offers/order-status': [new Error('down')] });
    expect(await adapter.checkStatus('1', creds)).toMatchObject({ status: 'PENDING' });
  });

  it('balance and health check use GET /offers/balance', async () => {
    const fn = mockApi({ '/api/v1/offers/balance': [resp({ balance: 500.25, currency: { id: 3, code: 'USD' } })] });
    expect(await adapter.getBalance(creds)).toEqual({ balance: 500.25, currency: 'USD' });
    expect(await adapter.healthCheck(creds)).toBe(true);
    expect(((fn.mock.calls[0] as unknown[])[1] as { method: string }).method).toBe('GET');
    mockApi({ '/api/v1/offers/balance': [resp({ error: 'INVALID_TOKEN' }, 401)] });
    expect(await adapter.healthCheck(creds)).toBe(false);
  });
});
