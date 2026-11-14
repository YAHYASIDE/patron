import { Injectable } from '@nestjs/common';
import { BaseHttpAdapter, ProviderHttpError } from './base-http.adapter';
import {
  CatalogOffer, DeliveredResult, FulfilOutcome, FulfilRequest, ProviderAdapter, ProviderAdapterCatalog,
  ProviderCredentials,
} from './provider-adapter.interface';

/** GamesDrop's documented test offer: synthetic quote, no real stock. */
export const GAMESDROP_TEST_OFFER = 999;

/** Customer input keys our products use for a player / server id, first match wins. */
const USER_ID_KEYS = ['player_id', 'user_id', 'uid', 'game_user_id', 'gameUserId', 'id'];
const SERVER_KEYS = ['server', 'zone_id', 'server_id', 'gameServerId'];

/** Our providerRef for an order whose creation outcome is unknown: look it up by our transactionId. */
const TX_PREFIX = 'tx:';

interface Quote {
  offerId: number;
  price: number;
  currency: string;
  canFulfillQuantity?: boolean;
  countryCompatibility?: 'allowed' | 'blocked' | 'unverified' | 'not_checked';
  isReturnDataForCustomer?: boolean;
  isRequiredGameUserId?: boolean;
  isRequiredGameServerId?: boolean;
  productOfferId?: number;
  error?: unknown;
}

interface SyncRow {
  offerGroupId: number;
  productName?: string;
  offerGroupName?: string;
  price: number;
  currency?: string;
  inStock?: boolean;
  isRequiredGameUserId?: boolean;
  isRequiredGameServerId?: boolean;
  regionName?: string;
  regionCode?: string;
  countryCompatibility?: string;
}

interface GdOrder {
  orderId?: number | string;
  transactionId?: string;
  status?: string;
  isReturnDataForCustomer?: boolean;
  key?: string;
  fulfillmentItems?: Array<{ key?: string; value?: string }>;
  failureCode?: string;
  failureReason?: string;
  error?: unknown;
}

/**
 * GamesDrop Partner API (https://gamesdrop.io/en/docs/partner-api), base URL
 * https://partner.gamesdrop.io, header `Authorization: <shop token>` (no
 * "Bearer"). One purchase is: find-one (live price) → check-game-data (direct
 * top-ups) → create-order with that price and our idempotency key as the
 * transactionId → order-status until COMPLETED / CANCELED.
 *
 * Money rules:
 * - never buy above `maxUnitCost` (the cost the owner set for this product);
 * - never create a second order after an unknown outcome: a timeout or
 *   SERVICE_UNAVAILABLE on create-order becomes PENDING with a `tx:` ref and
 *   is resolved by looking the same transactionId up;
 * - a player id the supplier rejects stops here (no purchase, no failover).
 *
 * Config (providers.extraConfig): `countryCode` (default MR) for activation
 * checks. Keys and codes are never logged.
 */
@Injectable()
export class GamesDropAdapter extends BaseHttpAdapter implements ProviderAdapter, ProviderAdapterCatalog {
  readonly code = 'gamesdrop';

  private headers(creds: ProviderCredentials) {
    return { authorization: creds.apiKey };
  }

  private country(creds: ProviderCredentials) {
    const c = creds.config?.countryCode;
    return typeof c === 'string' && /^[A-Z]{2}$/.test(c) ? c : 'MR';
  }

  async fulfil(req: FulfilRequest, creds: ProviderCredentials): Promise<FulfilOutcome> {
    const offerId = Number(req.providerSku);
    if (!Number.isInteger(offerId) || offerId <= 0) {
      return fail('bad_sku', `GamesDrop offer id must be a number, got "${req.providerSku}"`, false);
    }
    const countryCode = this.country(creds);

    let quote: Quote;
    try {
      quote = await this.post<Quote>(creds, '/api/v1/offers/find-one', { offerId, quantity: req.quantity, countryCode });
    } catch (err) {
      return this.toTransportFailure(err);
    }
    const quoteError = errorCode(quote);
    if (quoteError) return fail(quoteError.toLowerCase(), 'find-one refused the offer', quoteError !== 'OFFER_NOT_FOUND', quote);
    if (quote.canFulfillQuantity === false) return fail('out_of_stock', 'Not enough stock at GamesDrop', true, quote);
    if (quote.countryCompatibility === 'blocked') {
      return fail('country_blocked', `This offer cannot be activated in ${countryCode}`, false, quote);
    }
    const tooDear = this.priceCheck(quote.price, req.maxUnitCost, quote);
    if (tooDear) return tooDear;

    const customer: Record<string, string> = {};
    if (quote.isRequiredGameUserId) {
      const userId = pick(req.inputs, USER_ID_KEYS);
      if (!userId) return fail('missing_player_id', 'This offer needs a player id', false);
      customer.gameUserId = userId;
    }
    if (quote.isRequiredGameServerId) {
      const server = pick(req.inputs, SERVER_KEYS);
      if (!server) return fail('missing_server', 'This offer needs a game server', false);
      customer.gameServerId = server;
    }
    if (customer.gameUserId) {
      try {
        const check = await this.post<{ status?: string; message?: string }>(creds, '/api/v1/offers/check-game-data', {
          offerId,
          gameUserId: customer.gameUserId,
          ...(customer.gameServerId && { gameServerId: customer.gameServerId }),
        });
        if (check.status === 'INVALID') {
          return fail('invalid_player', 'GamesDrop rejected the player id', false, { status: check.status });
        }
      } catch (err) {
        return this.toTransportFailure(err);
      }
    }

    return this.createOrder(creds, req, offerId, countryCode, quote, customer, true);
  }

  private async createOrder(
    creds: ProviderCredentials,
    req: FulfilRequest,
    offerId: number,
    countryCode: string,
    quote: Quote,
    customer: Record<string, string>,
    mayRequote: boolean,
  ): Promise<FulfilOutcome> {
    let order: GdOrder;
    try {
      order = await this.post<GdOrder>(creds, '/api/v1/offers/create-order', {
        offerId,
        price: quote.price,
        transactionId: req.idempotencyKey,
        quantity: req.quantity,
        countryCode,
        ...(quote.productOfferId && { productOfferId: quote.productOfferId }),
        ...(Object.keys(customer).length && { customer }),
      });
    } catch (err) {
      const e = err as ProviderHttpError;
      // a 4xx is a refusal: nothing was bought
      if (e.status && e.status < 500 && e.status !== 429) {
        const code = errorCode(e.body);
        if (code === 'TRANSACTION_DUPLICATE') return this.byTransaction(creds, req.idempotencyKey);
        if (code === 'WRONG_PRICE' && mayRequote) return this.requote(creds, req, offerId, countryCode, customer);
        return fail((code ?? `http_${e.status}`).toLowerCase(), e.message, false, e.body);
      }
      // timeout / 5xx: the order may exist. Never buy again; look it up later.
      return this.unknownOutcome(req.idempotencyKey, e.message);
    }

    const code = errorCode(order);
    if (code === 'TRANSACTION_DUPLICATE') return this.byTransaction(creds, req.idempotencyKey);
    if (code === 'WRONG_PRICE' && mayRequote) return this.requote(creds, req, offerId, countryCode, customer);
    if (code === 'SERVICE_UNAVAILABLE') return this.unknownOutcome(req.idempotencyKey, 'SERVICE_UNAVAILABLE on create-order');
    if (code) return fail(code.toLowerCase(), 'create-order refused the order', false, order);
    return this.toOutcome(order, quote.isReturnDataForCustomer, quote.price);
  }

  /** The price moved between find-one and create-order: quote again once, still within cost. */
  private async requote(
    creds: ProviderCredentials,
    req: FulfilRequest,
    offerId: number,
    countryCode: string,
    customer: Record<string, string>,
  ): Promise<FulfilOutcome> {
    let quote: Quote;
    try {
      quote = await this.post<Quote>(creds, '/api/v1/offers/find-one', { offerId, quantity: req.quantity, countryCode });
    } catch (err) {
      return this.toTransportFailure(err);
    }
    const quoteError = errorCode(quote);
    if (quoteError) return fail(quoteError.toLowerCase(), 'find-one refused the offer', false, quote);
    const tooDear = this.priceCheck(quote.price, req.maxUnitCost, quote);
    if (tooDear) return tooDear;
    return this.createOrder(creds, req, offerId, countryCode, quote, customer, false);
  }

  private priceCheck(price: number, maxUnitCost: number | undefined, raw: unknown): FulfilOutcome | null {
    if (!Number.isFinite(price) || price <= 0) return fail('bad_quote', 'GamesDrop returned no usable price', true, raw);
    // a small tolerance for rounding; anything more waits for the owner
    if (maxUnitCost !== undefined && maxUnitCost > 0 && price > maxUnitCost * 1.005) {
      return fail('price_above_cost', `Supplier price ${price} is above the agreed cost ${maxUnitCost}`, false, raw);
    }
    return null;
  }

  private unknownOutcome(transactionId: string, why: string): FulfilOutcome {
    // order_id is what ProviderEngine.pollItem reads back from provider_calls
    return { status: 'PENDING', providerRef: `${TX_PREFIX}${transactionId}`, raw: { order_id: `${TX_PREFIX}${transactionId}`, note: why } };
  }

  private async byTransaction(creds: ProviderCredentials, transactionId: string): Promise<FulfilOutcome> {
    return this.checkStatus(`${TX_PREFIX}${transactionId}`, creds);
  }

  async checkStatus(providerRef: string, creds: ProviderCredentials): Promise<FulfilOutcome> {
    const body = providerRef.startsWith(TX_PREFIX)
      ? { transactionId: providerRef.slice(TX_PREFIX.length) }
      : { orderId: Number(providerRef) };
    try {
      const order = await this.post<GdOrder>(creds, '/api/v1/offers/order-status', body);
      const code = errorCode(order);
      if (code === 'ORDER_NOT_FOUND' && providerRef.startsWith(TX_PREFIX)) {
        // never accepted: safe to report as failed (nothing was charged)
        return fail('order_not_found', 'GamesDrop has no order for this transaction', true, order);
      }
      if (code) return { status: 'PENDING', providerRef, raw: { order_id: providerRef, error: code } };
      return this.toOutcome(order, order.isReturnDataForCustomer);
    } catch (err) {
      // a failed lookup proves nothing: keep waiting
      return { status: 'PENDING', providerRef, raw: { order_id: providerRef, note: (err as Error).message } };
    }
  }

  async searchCatalog(
    creds: ProviderCredentials,
    q: { search?: string; category?: string; page?: number },
  ): Promise<{ total: number; offers: CatalogOffer[] }> {
    const res = await this.post<{ count?: number; rows?: SyncRow[] }>(creds, '/api/v1/offers/sync', {
      limit: 50,
      page: q.page && q.page > 0 ? q.page : 1,
      countryCode: this.country(creds),
      ...(q.search && { search: q.search }),
      ...(q.category && { category: q.category }),
    });
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    return {
      total: Number(res?.count ?? rows.length),
      offers: rows.map((r) => ({
        sku: String(r.offerGroupId),
        productName: String(r.productName ?? ''),
        offerName: String(r.offerGroupName ?? ''),
        price: Number(r.price),
        currency: String(r.currency ?? ''),
        inStock: r.inStock !== false,
        needsPlayerId: r.isRequiredGameUserId === true,
        needsServer: r.isRequiredGameServerId === true,
        region: r.regionName ?? r.regionCode,
        countryCompatibility: r.countryCompatibility,
      })),
    };
  }

  /** Documented test flow: find-one 999, then create-order at the returned (synthetic) price. */
  testOrder(creds: ProviderCredentials, reference: string): Promise<FulfilOutcome> {
    return this.fulfil(
      {
        idempotencyKey: `test_${reference}`,
        providerSku: String(GAMESDROP_TEST_OFFER),
        quantity: 1,
        inputs: { player_id: '123456789' },
        reference,
      },
      creds,
    );
  }

  async getBalance(creds: ProviderCredentials) {
    const res = await this.request<{ balance: number; currency?: { code?: string } }>(creds, '/api/v1/offers/balance', {
      method: 'GET',
      headers: this.headers(creds),
    });
    // GamesDrop may answer an error with HTTP 200 (`{ error: CODE }`): no number means no balance
    if (!res || !Number.isFinite(Number(res.balance))) {
      throw new ProviderHttpError('GamesDropAdapter balance response without a balance', 200, res, false);
    }
    return { balance: Number(res.balance), currency: res.currency?.code ?? 'USD' };
  }

  async healthCheck(creds: ProviderCredentials) {
    try {
      await this.getBalance(creds);
      return true;
    } catch {
      return false;
    }
  }

  private post<T>(creds: ProviderCredentials, path: string, body: unknown) {
    return this.request<T>(creds, path, { body, headers: this.headers(creds) });
  }

  /** `unitPrice` (what GamesDrop charged per unit) is kept in raw for today's-spend accounting. */
  private toOutcome(order: GdOrder, returnsData: boolean | undefined, unitPrice?: number): FulfilOutcome {
    const orderId = order.orderId !== undefined ? String(order.orderId) : undefined;
    const ref = orderId ?? (order.transactionId ? `${TX_PREFIX}${order.transactionId}` : 'unknown');
    // keys are secrets: they go to the encrypted order results, never to provider_calls
    const raw = {
      order_id: ref, status: order.status, failureCode: order.failureCode, failureReason: order.failureReason,
      ...(unitPrice !== undefined && { unitPrice }),
    };
    switch ((order.status ?? '').toUpperCase()) {
      case 'COMPLETED':
      case 'DELIVERED': {
        const results: DeliveredResult[] = [];
        if (order.key) results.push({ resultType: 'code', value: order.key });
        for (const item of order.fulfillmentItems ?? []) {
          const v = item.key ?? item.value;
          if (v && v !== order.key) results.push({ resultType: 'code', value: v });
        }
        if (!results.length) {
          if (returnsData) return { status: 'PENDING', providerRef: ref, raw }; // key not attached yet
          results.push({ resultType: 'message', value: 'تم الشحن مباشرة إلى الحساب.' });
        }
        return { status: 'DELIVERED', providerRef: ref, results, raw };
      }
      case 'CANCELED':
      case 'CANCELLED':
      case 'FAILED':
      case 'REFUND':
        return fail((order.failureCode ?? 'supplier_failed').toLowerCase(), order.failureReason ?? `GamesDrop order ${order.status}`, false, raw);
      default:
        return { status: 'PENDING', providerRef: ref, raw };
    }
  }
}

function fail(errorCode: string, errorMessage: string, retryable: boolean, raw: unknown = null): FulfilOutcome {
  return { status: 'FAILED', errorCode, errorMessage, retryable, raw };
}

function pick(inputs: Record<string, string>, keys: string[]) {
  for (const k of keys) {
    const v = inputs[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

/** GamesDrop errors arrive as `error: "CODE"` or `error: { code }`, sometimes with HTTP 200. */
function errorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const e = (body as { error?: unknown }).error;
  if (typeof e === 'string' && e) return e.toUpperCase();
  if (e && typeof e === 'object') {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && c) return c.toUpperCase();
  }
  return undefined;
}
