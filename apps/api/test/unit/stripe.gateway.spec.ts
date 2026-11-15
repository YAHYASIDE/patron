import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { StripeGateway } from '../../src/modules/payments/gateways/stripe.gateway';

const SECRET_KEY = 'sk_test_123';
const WEBHOOK_SECRET = 'whsec_test';

function mockFetch(json: any, ok = true, status = 200) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status,
    json: jest.fn().mockResolvedValue(json),
  });
}

describe('StripeGateway', () => {
  let config: any;
  let gateway: StripeGateway;

  const baseReq = {
    paymentId: 'pay1',
    orderId: 'ord1',
    userId: 'usr1',
    amount: new Prisma.Decimal('25'),
    currency: 'USD',
    description: 'Order 1000',
  } as any;

  beforeEach(() => {
    global.fetch = jest.fn();
    config = {
      get: jest.fn((k: string) => (
        {
          'payments.stripeSecretKey': SECRET_KEY,
          'payments.stripeWebhookSecret': WEBHOOK_SECRET,
        } as Record<string, string>
      )[k]),
    };
    gateway = new StripeGateway(config);
  });

  afterEach(() => jest.restoreAllMocks());

  it('is a non-instant gateway with the STRIPE code', () => {
    expect(gateway.code).toBe('STRIPE');
    expect(gateway.isInstant).toBe(false);
  });

  describe('initiate', () => {
    beforeEach(() => {
      process.env.STOREFRONT_URL = 'https://store.example';
    });
    afterEach(() => {
      delete process.env.STOREFRONT_URL;
    });

    it("creates a hosted Checkout session and sends the customer to Stripe's page", async () => {
      mockFetch({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });

      const res = await gateway.initiate({ ...baseReq, returnUrl: 'https://store.example/orders/ord1' });

      expect(res).toEqual({
        status: 'REQUIRES_ACTION',
        gatewayRef: 'cs_1',
        redirectUrl: 'https://checkout.stripe.com/c/pay/cs_1',
        raw: expect.objectContaining({ id: 'cs_1' }),
      });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
      expect(init.body.get('mode')).toBe('payment');
      // decimal currency -> minor units are x100
      expect(init.body.get('line_items[0][price_data][unit_amount]')).toBe('2500');
      expect(init.body.get('line_items[0][price_data][currency]')).toBe('usd');
      expect(init.body.get('line_items[0][price_data][product_data][name]')).toBe('Order 1000');
      expect(init.body.get('client_reference_id')).toBe('pay1');
      expect(init.body.get('metadata[order_id]')).toBe('ord1');
      expect(init.body.get('success_url')).toBe('https://store.example/orders/ord1?card=done');
      expect(init.body.get('cancel_url')).toBe('https://store.example/orders/ord1?card=cancelled');
    });

    it('does not multiply zero-decimal currencies into minor units', async () => {
      mockFetch({ id: 'cs_2', url: 'https://checkout' });
      await gateway.initiate({ ...baseReq, currency: 'XOF', amount: new Prisma.Decimal('2500') });
      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(init.body.get('line_items[0][price_data][unit_amount]')).toBe('2500');
      expect(init.body.get('line_items[0][price_data][currency]')).toBe('xof');
    });

    it("never sends the customer back anywhere but the shop's own pages", async () => {
      mockFetch({ id: 'cs_3', url: 'https://checkout' });
      await gateway.initiate({ ...baseReq, returnUrl: 'https://evil.example/steal' });
      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(init.body.get('success_url')).toBe('https://store.example/orders/ord1?card=done');

      config.get.mockImplementation((k: string) => (k === 'app.corsOrigins' ? 'https://shop.example,https://other.example' : SECRET_KEY));
      mockFetch({ id: 'cs_4', url: 'https://checkout' });
      await gateway.initiate({ ...baseReq, returnUrl: 'https://other.example/orders/ord1?pay=STRIPE' });
      const init2 = (global.fetch as jest.Mock).mock.calls[1][1];
      expect(init2.body.get('success_url')).toBe('https://other.example/orders/ord1?pay=STRIPE&card=done');

      mockFetch({ id: 'cs_5', url: 'https://checkout' });
      await gateway.initiate({ ...baseReq, returnUrl: 'not a url' });
      expect((global.fetch as jest.Mock).mock.calls[2][1].body.get('cancel_url')).toBe('https://store.example/orders/ord1?card=cancelled');
    });

    it('maps a gateway error envelope to a FAILED result', async () => {
      mockFetch({ error: { message: 'currency not supported' } }, false, 400);
      const res = await gateway.initiate(baseReq);
      expect(res).toEqual({ status: 'FAILED', failureCode: 'gateway_error', failureReason: 'currency not supported' });
    });

    it('falls back to a status-based message when the error envelope is empty', async () => {
      mockFetch({}, false, 500);
      const res = await gateway.initiate(baseReq);
      expect(res).toEqual({ status: 'FAILED', failureCode: 'gateway_error', failureReason: 'Gateway returned 500' });
    });
  });

  describe('resumeUrl', () => {
    it('returns the page of a session still open, and nothing once it closed', async () => {
      mockFetch({ status: 'open', url: 'https://checkout/cs_1' });
      await expect(gateway.resumeUrl('cs_1')).resolves.toBe('https://checkout/cs_1');
      mockFetch({ status: 'expired', url: null });
      await expect(gateway.resumeUrl('cs_1')).resolves.toBeUndefined();
      expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1');
    });
  });

  describe('verify', () => {
    it('maps a paid session to CAPTURED', async () => {
      mockFetch({ status: 'complete', payment_status: 'paid' });
      const res = await gateway.verify('cs_1');
      expect(res).toEqual({ status: 'CAPTURED', raw: { status: 'complete', payment_status: 'paid' } });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });

    it('maps an expired session to FAILED', async () => {
      mockFetch({ status: 'expired', payment_status: 'unpaid' });
      await expect(gateway.verify('cs_1')).resolves.toMatchObject({ status: 'FAILED' });
    });

    it('keeps an open or unpaid session PENDING', async () => {
      mockFetch({ status: 'open', payment_status: 'unpaid' });
      await expect(gateway.verify('cs_1')).resolves.toMatchObject({ status: 'PENDING' });
    });
  });

  describe('refund', () => {
    it("refunds the session's card charge", async () => {
      mockFetch({ payment_intent: 'pi_1' });
      mockFetch({ id: 're_1' });
      const res = await gateway.refund({ gatewayRef: 'cs_1', amount: new Prisma.Decimal('10'), currency: 'USD', reason: 'duplicate' } as any);
      expect(res).toEqual({ gatewayRef: 're_1', raw: { id: 're_1' } });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[1];
      expect(url).toBe('https://api.stripe.com/v1/refunds');
      expect(init.body.get('payment_intent')).toBe('pi_1');
      expect(init.body.get('amount')).toBe('1000');
      expect(init.body.get('metadata[reason]')).toBe('duplicate');
    });

    it('refuses to refund a session that was never charged', async () => {
      mockFetch({ payment_intent: null });
      await expect(
        gateway.refund({ gatewayRef: 'cs_1', amount: new Prisma.Decimal('10'), currency: 'USD', reason: 'x' } as any),
      ).rejects.toThrow('never charged');
    });
  });

  describe('verifyWebhookSignature', () => {
    const rawBody = '{"id":"evt_1"}';

    function sign(t: number, body = rawBody, secret = WEBHOOK_SECRET) {
      return crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    }

    it('accepts a fresh, correctly-signed payload', () => {
      const t = Math.floor(Date.now() / 1000);
      const header = `t=${t},v1=${sign(t)}`;
      expect(gateway.verifyWebhookSignature(rawBody, { 'stripe-signature': header })).toBe(true);
    });

    it('rejects when the signing secret is not configured', () => {
      config.get.mockImplementation((k: string) =>
        k === 'payments.stripeWebhookSecret' ? undefined : SECRET_KEY,
      );
      const t = Math.floor(Date.now() / 1000);
      expect(
        gateway.verifyWebhookSignature(rawBody, { 'stripe-signature': `t=${t},v1=${sign(t)}` }),
      ).toBe(false);
    });

    it('rejects when the signature header is absent', () => {
      expect(gateway.verifyWebhookSignature(rawBody, {})).toBe(false);
    });

    it('rejects a malformed header missing t or v1', () => {
      expect(gateway.verifyWebhookSignature(rawBody, { 'stripe-signature': 'v1=abc' })).toBe(false);
    });

    it('rejects a timestamp outside the 5 minute tolerance', () => {
      const t = Math.floor(Date.now() / 1000) - 400;
      expect(
        gateway.verifyWebhookSignature(rawBody, { 'stripe-signature': `t=${t},v1=${sign(t)}` }),
      ).toBe(false);
    });

    it('rejects a same-length but incorrect signature', () => {
      const t = Math.floor(Date.now() / 1000);
      const wrong = sign(t).split('').reverse().join('');
      expect(
        gateway.verifyWebhookSignature(rawBody, { 'stripe-signature': `t=${t},v1=${wrong}` }),
      ).toBe(false);
    });
  });

  describe('parseWebhook', () => {
    const ev = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, data: { object: { id: 'cs_1', ...object } } });

    it('captures a completed session only once it is paid', () => {
      expect(gateway.parseWebhook(ev('checkout.session.completed', { payment_status: 'paid' }))).toEqual({
        eventId: 'evt_1',
        gatewayRef: 'cs_1',
        status: 'CAPTURED',
      });
      expect(gateway.parseWebhook(ev('checkout.session.completed', { payment_status: 'unpaid' }))).toBeNull();
      expect(gateway.parseWebhook(ev('checkout.session.async_payment_succeeded', {}))).toMatchObject({ status: 'CAPTURED' });
    });

    it('fails an expired session or a failed delayed payment', () => {
      expect(gateway.parseWebhook(ev('checkout.session.expired', {}))).toMatchObject({ status: 'FAILED', gatewayRef: 'cs_1' });
      expect(gateway.parseWebhook(ev('checkout.session.async_payment_failed', {}))).toMatchObject({ status: 'FAILED' });
    });

    it('returns null for an unhandled event type', () => {
      expect(gateway.parseWebhook(ev('charge.updated', {}))).toBeNull();
      expect(gateway.parseWebhook({})).toBeNull();
    });
  });
});
