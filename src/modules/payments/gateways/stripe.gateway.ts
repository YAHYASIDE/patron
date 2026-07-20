import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  InitiatePaymentRequest, InitiateResult, PaymentGateway, RefundRequest,
} from './payment-gateway.interface';

/**
 * Card gateway.
 *
 * Wired against Stripe's PaymentIntents shape. The HTTP calls are isolated in
 * `call()` so swapping to Moyasar or Tap for the MENA/West-Africa corridors is
 * this one file — nothing in PaymentsService knows the difference.
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

  private get secretKey() {
    return this.config.get<string>('payments.stripeSecretKey') ?? '';
  }

  private toMinorUnits(amount: { toString(): string }, currency: string): number {
    const value = Number(amount.toString());
    return StripeGateway.ZERO_DECIMAL.has(currency) ? Math.round(value) : Math.round(value * 100);
  }

  async initiate(req: InitiatePaymentRequest): Promise<InitiateResult> {
    try {
      const intent = await this.call<{ id: string; client_secret: string; next_action?: { redirect_to_url?: { url: string } } }>(
        'payment_intents',
        {
          amount: this.toMinorUnits(req.amount, req.currency),
          currency: req.currency.toLowerCase(),
          description: req.description,
          'metadata[order_id]': req.orderId,
          'metadata[payment_id]': req.paymentId,
        },
      );

      return {
        status: 'REQUIRES_ACTION',
        gatewayRef: intent.id,
        clientSecret: intent.client_secret,
        redirectUrl: intent.next_action?.redirect_to_url?.url,
        raw: intent,
      };
    } catch (err) {
      return { status: 'FAILED', failureCode: 'gateway_error', failureReason: (err as Error).message };
    }
  }

  async verify(gatewayRef: string) {
    const intent = await this.call<{ status: string }>(`payment_intents/${gatewayRef}`, undefined, 'GET');
    if (intent.status === 'succeeded') return { status: 'CAPTURED' as const, raw: intent };
    if (['requires_payment_method', 'canceled'].includes(intent.status)) {
      return { status: 'FAILED' as const, raw: intent };
    }
    return { status: 'PENDING' as const, raw: intent };
  }

  async refund(req: RefundRequest) {
    const refund = await this.call<{ id: string }>('refunds', {
      payment_intent: req.gatewayRef,
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
    const event = payload as { id: string; type: string; data: { object: { id: string } } };
    const map: Record<string, 'CAPTURED' | 'FAILED'> = {
      'payment_intent.succeeded': 'CAPTURED',
      'payment_intent.payment_failed': 'FAILED',
    };
    const status = map[event?.type];
    if (!status) return null;
    return { eventId: event.id, gatewayRef: event.data.object.id, status };
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
