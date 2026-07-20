/**
 * The contract every external provider must satisfy.
 *
 * Fulfilment code never knows which provider it is talking to — it resolves an
 * adapter from the registry by code. Adding FoxReload, or a third provider next
 * quarter, is a new class plus a database row: no `if (provider === ...)`
 * anywhere in the order pipeline.
 */

export interface ProviderCredentials {
  baseUrl: string;
  apiKey: string;
  apiSecret?: string;
  config?: Record<string, unknown>;
  timeoutMs: number;
}

export interface FulfilRequest {
  /** Stable per order item + attempt. Providers use it to dedupe retries. */
  idempotencyKey: string;
  providerSku: string;
  quantity: number;
  /** Customer-supplied fields (player_id, zone_id, email ...), decrypted. */
  inputs: Record<string, string>;
  reference: string; // our order item id, for support tickets
}

export type FulfilOutcome =
  | { status: 'DELIVERED'; providerRef: string; results: DeliveredResult[]; raw: unknown }
  /** Accepted but not yet complete — the engine will poll or await a webhook. */
  | { status: 'PENDING'; providerRef: string; raw: unknown }
  | { status: 'FAILED'; errorCode: string; errorMessage: string; retryable: boolean; raw: unknown };

export interface DeliveredResult {
  resultType: 'code' | 'serial' | 'receipt' | 'message';
  value: string;
}

export interface ProviderAdapter {
  readonly code: string;

  /** Submit a fulfilment request. MUST be safe to call twice with the same key. */
  fulfil(req: FulfilRequest, creds: ProviderCredentials): Promise<FulfilOutcome>;

  /** Poll a previously accepted request. */
  checkStatus(providerRef: string, creds: ProviderCredentials): Promise<FulfilOutcome>;

  /** Remaining credit with the provider, in the provider's own currency. */
  getBalance(creds: ProviderCredentials): Promise<{ balance: number; currency: string }>;

  /** Cheap liveness probe for the health checker. */
  healthCheck(creds: ProviderCredentials): Promise<boolean>;

  /** Verify an inbound webhook signature. Return null if unsupported. */
  verifyWebhook?(rawBody: string, headers: Record<string, string>, creds: ProviderCredentials): boolean;

  /** Map an inbound webhook to an outcome the engine understands. */
  parseWebhook?(payload: unknown): { providerRef: string; outcome: FulfilOutcome; eventId: string } | null;
}

export const PROVIDER_ADAPTER = Symbol('PROVIDER_ADAPTER');
