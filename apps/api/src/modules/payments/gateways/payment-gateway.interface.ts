import { Prisma } from '@prisma/client';

/**
 * Payment providers differ far more than fulfilment providers: some redirect,
 * some tokenise, some settle instantly. The abstraction is deliberately thin —
 * initiate, confirm, refund, verify webhook — so a gateway that does not fit
 * (wallet, cash) can still implement it honestly.
 */

export interface InitiatePaymentRequest {
  paymentId: string;
  orderId: string;
  userId: string;
  amount: Prisma.Decimal;
  currency: string;
  description: string;
  returnUrl?: string;
  metadata?: Record<string, string>;
}

export type InitiateResult =
  /** Settled synchronously (wallet). */
  | { status: 'CAPTURED'; gatewayRef: string; raw?: unknown }
  /** Needs customer action; the client redirects or opens an SDK sheet. */
  | { status: 'REQUIRES_ACTION'; gatewayRef: string; redirectUrl?: string; clientSecret?: string; raw?: unknown }
  | { status: 'FAILED'; failureCode: string; failureReason: string; raw?: unknown };

export interface RefundRequest {
  gatewayRef: string;
  amount: Prisma.Decimal;
  currency: string;
  reason: string;
}

export interface PaymentGateway {
  readonly code: string;
  /** Whether funds move instantly (affects when fulfilment is triggered). */
  readonly isInstant: boolean;

  initiate(req: InitiatePaymentRequest): Promise<InitiateResult>;
  /** Confirm final state with the gateway — never trust the client's word. */
  verify(gatewayRef: string): Promise<{ status: 'CAPTURED' | 'FAILED' | 'PENDING'; raw?: unknown }>;
  refund(req: RefundRequest): Promise<{ gatewayRef: string; raw?: unknown }>;
  verifyWebhookSignature?(rawBody: string, headers: Record<string, string>): boolean;
  parseWebhook?(payload: unknown): { eventId: string; gatewayRef: string; status: 'CAPTURED' | 'FAILED' } | null;
}
