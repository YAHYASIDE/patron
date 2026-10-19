import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  InitiatePaymentRequest, InitiateResult, PaymentGateway, RefundRequest,
} from './payment-gateway.interface';

/** System setting holding the owner's transfer accounts (Bankily, Masrvi, bank, ...). */
export const MANUAL_ACCOUNTS_KEY = 'payments.manual_accounts';
export const MANUAL_NOTE_KEY = 'payments.manual_note';

/** "Every other country" in `countries`. */
export const OTHER_COUNTRIES = 'XX';

/** How the customer paid, which decides what we ask them for ("the number you paid from"). */
export type AccountKind = 'mobile' | 'bank' | 'crypto';

export interface ManualAccount {
  id: string;
  method: string; // e.g. "Bankily", "Masrvi", "Binance Pay"
  /** ISO 3166-1 alpha-2 codes it is offered in; "XX" = every other country. Empty = everywhere. */
  countries: string[];
  accountName: string; // may be empty: a number is enough for mobile money
  accountNumber: string; // phone number, RIB, Binance Pay ID or wallet address
  kind: AccountKind;
  /** A built-in logo key ("bankily") or "upload:<id>" for one the owner uploaded. */
  logo?: string;
  /** Off until the owner gives the receiving number; hidden from customers. */
  enabled: boolean;
  instructions?: string;
}

/** Older rows had one `country` and no kind/enabled flag. */
export function normalizeAccount(raw: Partial<ManualAccount> & { country?: string }): ManualAccount {
  return {
    id: String(raw.id ?? ''),
    method: raw.method ?? '',
    countries: raw.countries ?? (raw.country ? [raw.country] : []),
    accountName: raw.accountName ?? '',
    accountNumber: raw.accountNumber ?? '',
    kind: raw.kind ?? 'mobile',
    ...(raw.logo && { logo: raw.logo }),
    enabled: raw.enabled ?? true,
    ...(raw.instructions && { instructions: raw.instructions }),
  };
}

/** What a customer may be shown: switched on and with somewhere to send the money. */
export const isUsable = (a: ManualAccount) => a.enabled && a.accountNumber.trim().length > 0;

/**
 * Manual transfer: the customer sends money outside the platform (bank or
 * mobile-money transfer) and submits the transaction reference; staff check
 * their account and approve or reject. Nothing settles here, so `verify` only
 * reports what staff decided, and the payment moves through:
 *
 *   INITIATED (instructions shown) → AUTHORIZED (reference submitted, awaiting
 *   review) → CAPTURED (staff approved) | FAILED (staff rejected)
 *
 * Listed at checkout only once the owner has configured at least one account.
 */
@Injectable()
export class ManualTransferGateway implements PaymentGateway {
  readonly code = 'MANUAL';
  readonly isInstant = false;
  /** PaymentsService keeps the payment INITIATED until the customer submits a reference. */
  readonly awaitsCustomerProof = true;

  constructor(private prisma: PrismaService) {}

  async isEnabled(): Promise<boolean> {
    return (await this.accounts()).some(isUsable);
  }

  /** Every account the owner configured, including switched-off ones. */
  async accounts(): Promise<ManualAccount[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_ACCOUNTS_KEY } });
    return Array.isArray(row?.value) ? (row.value as unknown as ManualAccount[]).map(normalizeAccount) : [];
  }

  initiate(req: InitiatePaymentRequest): Promise<InitiateResult> {
    return Promise.resolve({ status: 'REQUIRES_ACTION', gatewayRef: `manual_${req.paymentId}` });
  }

  async verify(gatewayRef: string) {
    const payment = await this.prisma.payment.findUnique({ where: { gatewayRef } });
    if (payment?.status === 'CAPTURED') return { status: 'CAPTURED' as const };
    if (!payment || payment.status === 'FAILED') return { status: 'FAILED' as const };
    return { status: 'PENDING' as const };
  }

  refund(req: RefundRequest): Promise<{ gatewayRef: string }> {
    // Money goes back the way it came, by hand; the refund record is the audit trail.
    return Promise.resolve({ gatewayRef: `manualrefund_${req.gatewayRef}` });
  }
}
