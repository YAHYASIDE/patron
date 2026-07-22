import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { BaseHttpAdapter } from './base-http.adapter';
import {
  FulfilOutcome, FulfilRequest, ProviderAdapter, ProviderCredentials,
} from './provider-adapter.interface';

/**
 * FazerCards — primary provider.
 *
 * NOTE: response field names below reflect the integration spec. Verify against
 * the sandbox before go-live; only this file changes if they differ.
 */
@Injectable()
export class FazerCardsAdapter extends BaseHttpAdapter implements ProviderAdapter {
  readonly code = 'fazercards';

  private headers(creds: ProviderCredentials) {
    return { authorization: `Bearer ${creds.apiKey}` };
  }

  async fulfil(req: FulfilRequest, creds: ProviderCredentials): Promise<FulfilOutcome> {
    try {
      const body = {
        product_code: req.providerSku,
        quantity: req.quantity,
        reference: req.reference,
        // Passing our key through means a retry after a timeout returns the
        // original order instead of buying twice.
        idempotency_key: req.idempotencyKey,
        fields: req.inputs,
      };

      const res = await this.request<FazerResponse>(creds, '/orders', { body, headers: this.headers(creds) });
      return this.toOutcome(res);
    } catch (err) {
      return this.toFailure(err);
    }
  }

  async checkStatus(providerRef: string, creds: ProviderCredentials): Promise<FulfilOutcome> {
    try {
      const res = await this.request<FazerResponse>(creds, `/orders/${providerRef}`, {
        method: 'GET',
        headers: this.headers(creds),
      });
      return this.toOutcome(res);
    } catch (err) {
      return this.toFailure(err);
    }
  }

  async getBalance(creds: ProviderCredentials) {
    const res = await this.request<{ balance: number; currency: string }>(creds, '/account/balance', {
      method: 'GET',
      headers: this.headers(creds),
    });
    return { balance: Number(res.balance), currency: res.currency };
  }

  async healthCheck(creds: ProviderCredentials) {
    try {
      await this.request(creds, '/ping', { method: 'GET', headers: this.headers(creds) });
      return true;
    } catch {
      return false;
    }
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>, creds: ProviderCredentials) {
    const signature = headers['x-fazer-signature'];
    if (!signature || !creds.apiSecret) return false;
    const expected = crypto.createHmac('sha256', creds.apiSecret).update(rawBody).digest('hex');
    // Constant-time compare — a naive === leaks the signature byte by byte.
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown) {
    const event = payload as { event_id?: string; order_id?: string; data?: FazerResponse };
    if (!event?.order_id || !event.data) return null;
    return {
      eventId: event.event_id ?? event.order_id,
      providerRef: event.order_id,
      outcome: this.toOutcome(event.data),
    };
  }

  private toOutcome(res: FazerResponse): FulfilOutcome {
    switch (res.status) {
      case 'completed':
        return {
          status: 'DELIVERED',
          providerRef: res.order_id,
          results: (res.codes ?? []).map((c) => ({ resultType: 'code' as const, value: c })),
          raw: res,
        };
      case 'pending':
      case 'processing':
        return { status: 'PENDING', providerRef: res.order_id, raw: res };
      default:
        return {
          status: 'FAILED',
          errorCode: res.error_code ?? 'unknown',
          errorMessage: res.message ?? 'Provider rejected the order',
          // Out of stock or a bad player ID will not fix itself on retry;
          // a provider-side balance issue might.
          retryable: res.error_code === 'insufficient_balance' || res.error_code === 'temporary_failure',
          raw: res,
        };
    }
  }

  private toFailure(err: unknown): FulfilOutcome {
    return this.toTransportFailure(err);
  }
}

interface FazerResponse {
  order_id: string;
  status: 'completed' | 'pending' | 'processing' | 'failed' | 'rejected';
  codes?: string[];
  error_code?: string;
  message?: string;
}
