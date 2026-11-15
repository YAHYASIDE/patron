import { Prisma, WalletTxnType } from '@prisma/client';
import { WalletGateway } from '../../src/modules/payments/gateways/wallet.gateway';

describe('WalletGateway', () => {
  let prisma: any;
  let wallet: any;
  let gateway: WalletGateway;

  const tx = {} as any;

  const req = {
    paymentId: 'pay1',
    orderId: 'ord1',
    userId: 'usr1',
    amount: new Prisma.Decimal('25.00'),
    currency: 'USD',
    description: 'Order 1000',
  } as any;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((fn: any) => fn(tx)),
      payment: { findUnique: jest.fn() },
    };
    wallet = { debit: jest.fn().mockResolvedValue(undefined) };
    gateway = new WalletGateway(prisma, wallet);
  });

  it('is an instant gateway with the WALLET code', () => {
    expect(gateway.code).toBe('WALLET');
    expect(gateway.isInstant).toBe(true);
  });

  describe('initiate', () => {
    it('debits the wallet inside a transaction and captures synchronously', async () => {
      const res = await gateway.initiate(req);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(wallet.debit).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'usr1',
          currency: 'USD',
          amount: req.amount,
          type: WalletTxnType.ORDER_PAYMENT,
          referenceType: 'order',
          referenceId: 'ord1',
          description: 'Order 1000',
        }),
        tx,
      );
      expect(res).toEqual({ status: 'CAPTURED', gatewayRef: 'wallet_pay1' });
    });

    it('returns a FAILED result with insufficient_funds when the debit throws', async () => {
      wallet.debit.mockRejectedValue(new Error('Insufficient balance'));

      const res = await gateway.initiate(req);

      expect(res).toEqual({
        status: 'FAILED',
        failureCode: 'insufficient_funds',
        failureReason: 'Insufficient balance',
      });
    });
  });

  describe('verify', () => {
    it('reports CAPTURED when the referenced payment is captured', async () => {
      prisma.payment.findUnique.mockResolvedValue({ status: 'CAPTURED' });
      await expect(gateway.verify('wallet_pay1')).resolves.toEqual({ status: 'CAPTURED' });
      expect(prisma.payment.findUnique).toHaveBeenCalledWith({ where: { gatewayRef: 'wallet_pay1' } });
    });

    it('reports FAILED when no payment matches the gatewayRef', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(gateway.verify('missing')).resolves.toEqual({ status: 'FAILED' });
    });

    it('reports FAILED when the payment is in any non-captured status', async () => {
      prisma.payment.findUnique.mockResolvedValue({ status: 'INITIATED' });
      await expect(gateway.verify('wallet_pay1')).resolves.toEqual({ status: 'FAILED' });
    });
  });

  describe('refund', () => {
    it('returns a synthetic gatewayRef without any external call', async () => {
      const res = await gateway.refund({
        gatewayRef: 'wallet_pay1',
        amount: new Prisma.Decimal('5'),
        currency: 'USD',
        reason: 'test',
      } as any);
      expect(res).toEqual({ gatewayRef: 'walletrefund_wallet_pay1' });
    });
  });
});
