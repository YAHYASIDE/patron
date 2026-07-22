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
    it('creates a PaymentIntent and returns REQUIRES_ACTION with client secret and redirect', async () => {
      mockFetch({
        id: 'pi_1',
        client_secret: 'cs_1',
        next_action: { redirect_to_url: { url: 'https://redirect' } },
      });

      const res = await gateway.initiate(baseReq);

      expect(res).toEqual({
        status: 'REQUIRES_ACTION',
        gatewayRef: 'pi_1',
        clientSecret: 'cs_1',
        redirectUrl: 'https://redirect',
        raw: expect.objectContaining({ id: 'pi_1' }),
      });

      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/payment_intents');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe(`Bearer ${SECRET_KEY}`);
      // decimal currency -> minor units are x100
      expect(init.body.get('amount')).toBe('2500');
      expect(init.body.get('currency')).toBe('usd');
      expect(init.body.get('metadata[order_id]')).toBe('ord1');
      expect(init.body.get('metadata[payment_id]')).toBe('pay1');
    });

    it('does not multiply zero-decimal currencies into minor units', async () => {
      mockFetch({ id: 'pi_2', client_secret: 'cs_2' });

      await gateway.initiate({ ...baseReq, currency: 'XOF', amount: new Prisma.Decimal('2500') });

      const init = (global.fetch as jest.Mock).mock.calls[0][1];
      expect(init.body.get('amount')).toBe('2500');
      expect(init.body.get('currency')).toBe('xof');
    });

    it('omits redirectUrl when the intent needs no next action', async () => {
      mockFetch({ id: 'pi_3', client_secret: 'cs_3' });
      const res = await gateway.initiate(baseReq);
      expect(res).toMatchObject({ status: 'REQUIRES_ACTION', redirectUrl: undefined });
    });

    it('maps a gateway error envelope to a FAILED result', async () => {
      mockFetch({ error: { message: 'card_declined' } }, false, 402);
      const res = await gateway.initiate(baseReq);
      expect(res).toEqual({
        status: 'FAILED',
        failureCode: 'gateway_error',
        failureReason: 'card_declined',
      });
    });

    it('falls back to a status-based message when the error envelope is empty', async () => {
      mockFetch({}, false, 500);
      const res = await gateway.initiate(baseReq);
      expect(res).toEqual({
        status: 'FAILED',
        failureCode: 'gateway_error',
        failureReason: 'Gateway returned 500',
      });
    });
  });

  describe('verify', () => {
    it('maps succeeded to CAPTURED', async () => {
      mockFetch({ status: 'succeeded' });
      const res = await gateway.verify('pi_1');
      expect(res).toEqual({ status: 'CAPTURED', raw: { status: 'succeeded' } });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/payment_intents/pi_1');
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
    });

    it('maps requires_payment_method and canceled to FAILED', async () => {
      mockFetch({ status: 'requires_payment_method' });
      await expect(gateway.verify('pi_1')).resolves.toMatchObject({ status: 'FAILED' });
      mockFetch({ status: 'canceled' });
      await expect(gateway.verify('pi_1')).resolves.toMatchObject({ status: 'FAILED' });
    });

    it('maps any other status to PENDING', async () => {
      mockFetch({ status: 'processing' });
      await expect(gateway.verify('pi_1')).resolves.toMatchObject({ status: 'PENDING' });
    });
  });

  describe('refund', () => {
    it('posts a refund and returns its gatewayRef', async () => {
      mockFetch({ id: 're_1' });
      const res = await gateway.refund({
        gatewayRef: 'pi_1',
        amount: new Prisma.Decimal('10'),
        currency: 'USD',
        reason: 'duplicate',
      } as any);
      expect(res).toEqual({ gatewayRef: 're_1', raw: { id: 're_1' } });
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://api.stripe.com/v1/refunds');
      expect(init.body.get('payment_intent')).toBe('pi_1');
      expect(init.body.get('amount')).toBe('1000');
      expect(init.body.get('metadata[reason]')).toBe('duplicate');
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
    it('maps payment_intent.succeeded to CAPTURED', () => {
      expect(
        gateway.parseWebhook({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } }),
      ).toEqual({ eventId: 'evt_1', gatewayRef: 'pi_1', status: 'CAPTURED' });
    });

    it('maps payment_intent.payment_failed to FAILED', () => {
      expect(
        gateway.parseWebhook({ id: 'evt_2', type: 'payment_intent.payment_failed', data: { object: { id: 'pi_2' } } }),
      ).toEqual({ eventId: 'evt_2', gatewayRef: 'pi_2', status: 'FAILED' });
    });

    it('returns null for an unhandled event type', () => {
      expect(
        gateway.parseWebhook({ id: 'evt_3', type: 'charge.updated', data: { object: { id: 'ch_1' } } }),
      ).toBeNull();
    });
  });
});
