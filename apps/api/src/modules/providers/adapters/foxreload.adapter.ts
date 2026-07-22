import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { BaseHttpAdapter } from './base-http.adapter';
import {
  FulfilOutcome, FulfilRequest, ProviderAdapter, ProviderCredentials,
} from './provider-adapter.interface';

/**
 * FoxReload — secondary / failover provider.
 *
 * Deliberately different in shape from FazerCards (signed requests, numeric
 * status codes, snake-cased envelope) to prove the abstraction holds: the
 * engine treats both identically.
 */
@Injectable()
export class FoxReloadAdapter extends BaseHttpAdapter implements ProviderAdapter {
  readonly code = 'foxreload';

  /** FoxReload signs the payload rather than using a bearer token. */
  private sign(body: Record<string, unknown>, creds: ProviderCredentials) {
    const payload = JSON.stringify(body);
    const signature = crypto
      .createHmac('sha256', creds.apiSecret ?? creds.apiKey)
      .update(payload)
      .digest('hex');
    return { 'x-api-key': creds.apiKey, 'x-signature': signature };
  }

  async fulfil(req: FulfilRequest, creds: ProviderCredentials): Promise<FulfilOutcome> {
    try {
      const body = {
        sku: req.providerSku,
        qty: req.quantity,
        client_ref: req.reference,
        request_id: req.idempotencyKey,
        params: req.inputs,
      };
      const res = await this.request<FoxResponse>(creds, '/transactions', {
        body,
        headers: this.sign(body, creds),
      });
      return this.toOutcome(res);
    } catch (err) {
      return this.toFailure(err);
    }
  }

  async checkStatus(providerRef: string, creds: ProviderCredentials): Promise<FulfilOutcome> {
    try {
      const res = await this.request<FoxResponse>(creds, `/transactions/${providerRef}`, {
        method: 'GET',
        headers: { 'x-api-key': creds.apiKey },
      });
      return this.toOutcome(res);
    } catch (err) {
      return this.toFailure(err);
    }
  }

  async getBalance(creds: ProviderCredentials) {
    const res = await this.request<{ data: { credit: string; currency: string } }>(creds, '/account', {
      method: 'GET',
      headers: { 'x-api-key': creds.apiKey },
    });
    return { balance: Number(res.data.credit), currency: res.data.currency };
  }

  async healthCheck(creds: ProviderCredentials) {
    try {
      await this.request(creds, '/health', { method: 'GET', headers: { 'x-api-key': creds.apiKey } });
      return true;
    } catch {
      return false;
    }
  }

  verifyWebhook(rawBody: string, headers: Record<string, string>, creds: ProviderCredentials) {
    const signature = headers['x-signature'];
    if (!signature) return false;
    const expected = crypto
      .createHmac('sha256', creds.apiSecret ?? creds.apiKey)
      .update(rawBody)
      .digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown) {
    const event = payload as { id?: string; transaction?: FoxResponse };
    if (!event?.transaction) return null;
    return {
      eventId: event.id ?? event.transaction.txn_id,
      providerRef: event.transaction.txn_id,
      outcome: this.toOutcome(event.transaction),
    };
  }

  private toOutcome(res: FoxResponse): FulfilOutcome {
    // 1 = success, 2 = in progress, anything else is a failure
    if (res.status_code === 1) {
      const results = [
        ...(res.pin ? [{ resultType: 'code' as const, value: res.pin }] : []),
        ...(res.serial ? [{ resultType: 'serial' as const, value: res.serial }] : []),
      ];
      return {
        status: 'DELIVERED',
        providerRef: res.txn_id,
        results: results.length ? results : [{ resultType: 'receipt', value: res.txn_id }],
        raw: res,
      };
    }
    if (res.status_code === 2) return { status: 'PENDING', providerRef: res.txn_id, raw: res };

    return {
      status: 'FAILED',
      errorCode: String(res.status_code),
      errorMessage: res.status_message ?? 'Transaction failed',
      retryable: res.status_code === 3, // 3 = provider temporarily unavailable
      raw: res,
    };
  }

  private toFailure(err: unknown): FulfilOutcome {
    return this.toTransportFailure(err);
  }
}

interface FoxResponse {
  txn_id: string;
  status_code: number;
  status_message?: string;
  pin?: string;
  serial?: string;
}
