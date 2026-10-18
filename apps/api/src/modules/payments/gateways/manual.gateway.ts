import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  InitiatePaymentRequest, InitiateResult, PaymentGateway, RefundRequest,
} from './payment-gateway.interface';

/** System setting holding the owner's transfer accounts (Bankily, Masrvi, bank, ...). */
export const MANUAL_ACCOUNTS_KEY = 'payments.manual_accounts';
export const MANUAL_NOTE_KEY = 'payments.manual_note';

export interface ManualAccount {
  id: string;
  method: string; // e.g. "Bankily", "Masrvi", "Sedad", "Bank transfer"
  country?: string; // ISO 3166-1 alpha-2, e.g. "MR"
  accountName: string;
  accountNumber: string;
  instructions?: string;
}

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
    return (await this.accounts()).length > 0;
  }

  async accounts(): Promise<ManualAccount[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_ACCOUNTS_KEY } });
    return Array.isArray(row?.value) ? (row.value as unknown as ManualAccount[]) : [];
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
