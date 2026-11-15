import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  InitiatePaymentRequest, InitiateResult, PaymentGateway, RefundRequest,
} from './payment-gateway.interface';

/**
 * Card gateway, through Stripe's hosted Checkout page: the customer is sent to
 * Stripe to type the card and comes back to their order, so the shop never
 * handles card numbers and needs no card form. The gateway reference is the
 * Checkout Session id. The HTTP calls are isolated in `call()` so swapping to
 * another card provider is this one file — nothing in PaymentsService knows
 * the difference.
 *
 * Amounts are converted to minor units per currency: XOF has none, so 2500 XOF
 * is 2500, not 250000. Getting this wrong is a 100× overcharge.
 */
@Injectable()
export class StripeGateway implements PaymentGateway {
  readonly code = 'STRIPE';
  readonly isInstant = false;
  private readonly logger = new Logger(StripeGateway.name);

  private static readonly ZERO_DECIMAL = new Set(['XOF', 'XAF', 'JPY', 'KRW', 'VND']);

  constructor(private config: ConfigService) {}

  /** Offered only once a secret key is configured (STRIPE_SECRET_KEY). */
  isEnabled(): boolean {
    return this.secretKey.length > 0;
  }

  private get secretKey() {
    return this.config.get<string>('payments.stripeSecretKey') ?? '';
  }

  private toMinorUnits(amount: { toString(): string }, currency: string): number {
    const value = Number(amount.toString());
    return StripeGateway.ZERO_DECIMAL.has(currency) ? Math.round(value) : Math.round(value * 100);
  }

  /**
   * Where Stripe sends the customer back. Only the shop's own origins are
   * accepted (CORS_ORIGINS / STOREFRONT_URL), so the link cannot be pointed
   * at another site; anything else returns them to their order page.
   */
  private returnTo(req: InitiatePaymentRequest): string {
    const store = (process.env.STOREFRONT_URL ?? '').replace(/\/+$/, '');
    const allowed = new Set(
      [store, ...(this.config.get<string>('app.corsOrigins') ?? '').split(',')].map((o) => o.trim()).filter(Boolean),
    );
    try {
      const url = new URL(req.returnUrl ?? '');
      if (allowed.has(url.origin)) return url.toString();
    } catch {
      /* not a URL */
    }
    return `${store}/orders/${req.orderId}`;
  }

  async initiate(req: InitiatePaymentRequest): Promise<InitiateResult> {
    try {
      const back = this.returnTo(req);
      const sep = back.includes('?') ? '&' : '?';
      const session = await this.call<{ id: string; url: string }>('checkout/sessions', {
        mode: 'payment',
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': req.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': this.toMinorUnits(req.amount, req.currency),
        'line_items[0][price_data][product_data][name]': req.description,
        client_reference_id: req.paymentId,
        'metadata[order_id]': req.orderId,
        'metadata[payment_id]': req.paymentId,
        success_url: `${back}${sep}card=done`,
        cancel_url: `${back}${sep}card=cancelled`,
      });
      return { status: 'REQUIRES_ACTION', gatewayRef: session.id, redirectUrl: session.url, raw: session };
    } catch (err) {
      return { status: 'FAILED', failureCode: 'gateway_error', failureReason: (err as Error).message };
    }
  }

  /** The Checkout page of a session still open, to send the customer back to it. */
  async resumeUrl(gatewayRef: string): Promise<string | undefined> {
    const session = await this.call<{ status: string; url?: string | null }>(`checkout/sessions/${gatewayRef}`, undefined, 'GET');
    return session.status === 'open' ? (session.url ?? undefined) : undefined;
  }

  async verify(gatewayRef: string) {
    const session = await this.call<{ status: string; payment_status: string }>(`checkout/sessions/${gatewayRef}`, undefined, 'GET');
    if (session.payment_status === 'paid') return { status: 'CAPTURED' as const, raw: session };
    if (session.status === 'expired') return { status: 'FAILED' as const, raw: session };
    return { status: 'PENDING' as const, raw: session };
  }

  async refund(req: RefundRequest) {
    // a refund is made against the card charge the session produced
    const session = await this.call<{ payment_intent: string | null }>(`checkout/sessions/${req.gatewayRef}`, undefined, 'GET');
    if (!session.payment_intent) throw new Error('This card payment was never charged');
    const refund = await this.call<{ id: string }>('refunds', {
      payment_intent: session.payment_intent,
      amount: this.toMinorUnits(req.amount, req.currency),
      'metadata[reason]': req.reason,
    });
    return { gatewayRef: refund.id, raw: refund };
  }

  verifyWebhookSignature(rawBody: string, headers: Record<string, string>) {
    const secret = this.config.get<string>('payments.stripeWebhookSecret');
    const header = headers['stripe-signature'];
    if (!secret || !header) return false;

    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    if (!parts.t || !parts.v1) return false;

    // Reject old signatures — otherwise a captured webhook can be replayed later.
    if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return false;

    const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
    const a = Buffer.from(parts.v1);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown) {
    const event = payload as { id: string; type: string; data: { object: { id: string; payment_status?: string } } };
    const session = event?.data?.object;
    let status: 'CAPTURED' | 'FAILED' | null = null;
    // "completed" can arrive before the money for slower methods: only "paid" settles
    if (event?.type === 'checkout.session.completed') status = session?.payment_status === 'paid' ? 'CAPTURED' : null;
    if (event?.type === 'checkout.session.async_payment_succeeded') status = 'CAPTURED';
    if (event?.type === 'checkout.session.async_payment_failed' || event?.type === 'checkout.session.expired') status = 'FAILED';
    if (!status) return null;
    return { eventId: event.id, gatewayRef: session.id, status };
  }

  private async call<T>(path: string, body?: Record<string, string | number>, method = 'POST'): Promise<T> {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: body ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])) : undefined,
    });
    // Stripe returns either the requested resource or an error envelope.
    const json = (await res.json()) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(json?.error?.message ?? `Gateway returned ${res.status}`);
    return json;
  }
}
