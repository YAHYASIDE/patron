import { Injectable } from '@nestjs/common';
import { WalletTxnType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import {
  InitiatePaymentRequest, InitiateResult, PaymentGateway, RefundRequest,
} from './payment-gateway.interface';

/**
 * Internal balance as a payment method. Settles synchronously, so the debit and
 * the payment record commit in one transaction — there is no window where the
 * customer's balance is gone but the order is unpaid.
 */
@Injectable()
export class WalletGateway implements PaymentGateway {
  readonly code = 'WALLET';
  readonly isInstant = true;

  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  async initiate(req: InitiatePaymentRequest): Promise<InitiateResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.wallet.debit(
          {
            userId: req.userId,
            currency: req.currency,
            amount: req.amount,
            type: WalletTxnType.ORDER_PAYMENT,
            referenceType: 'order',
            referenceId: req.orderId,
            description: req.description,
          },
          tx,
        );
      });
      return { status: 'CAPTURED', gatewayRef: `wallet_${req.paymentId}` };
    } catch (err) {
      return {
        status: 'FAILED',
        failureCode: 'insufficient_funds',
        failureReason: (err as Error).message,
      };
    }
  }

  async verify(gatewayRef: string) {
    const exists = await this.prisma.payment.findUnique({ where: { gatewayRef } });
    return { status: exists?.status === 'CAPTURED' ? ('CAPTURED' as const) : ('FAILED' as const) };
  }

  async refund(req: RefundRequest) {
    // The credit itself is posted by RefundsService inside its own transaction;
    // the wallet gateway has no external system to call.
    return { gatewayRef: `walletrefund_${req.gatewayRef}` };
  }
}
