import { NotFoundException } from '@nestjs/common';
import { Prisma, RefundStatus, WalletTxnType } from '@prisma/client';
import { RefundsService } from '../../src/modules/refunds/refunds.service';

describe('RefundsService', () => {
  let prisma: any;
  let wallet: any;
  let gateways: any;
  let gateway: any;
  let outbox: any;
  let service: RefundsService;
  let tx: any;

  const order = {
    id: 'ord1',
    userId: 'usr1',
    orderNumber: 'ORD-1000',
    total: new Prisma.Decimal('100'),
    currency: 'USD',
    fxRate: new Prisma.Decimal('2'),
    payments: [{ id: 'pay1', gateway: 'STRIPE', gatewayRef: 'pi_1' }],
    refunds: [],
  };

  beforeEach(() => {
    tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      refund: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal('100') } }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ref1', status: 'PROCESSED' }),
      },
      payment: { update: jest.fn().mockResolvedValue({}) },
      order: { update: jest.fn().mockResolvedValue({}) },
      orderItem: { updateMany: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      refund: {
        create: jest.fn().mockResolvedValue({ id: 'ref1' }),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 'ref1', status: 'REJECTED' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    wallet = {
      lockWallet: jest.fn().mockResolvedValue(undefined),
      credit: jest.fn().mockResolvedValue(undefined),
    };
    gateway = { refund: jest.fn().mockResolvedValue({ gatewayRef: 're_1' }) };
    gateways = { get: jest.fn(() => gateway) };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    service = new RefundsService(prisma, wallet, gateways, outbox);
  });

  describe('request', () => {
    it('throws NotFound when the order is missing', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.request('ord1', undefined, 'x', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an order with no captured payment', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...order, payments: [] });
      await expect(service.request('ord1', undefined, 'x', 'admin')).rejects.toThrow('no captured payment');
    });

    it('creates a full refund for the outstanding balance when no amount is given', async () => {
      await service.request('ord1', undefined, 'defective', 'admin', true);

      const data = prisma.refund.create.mock.calls[0][0].data;
      expect(data.amount.toString()).toBe('100');
      // amountBase = amount / fxRate, 4 dp
      expect(data.amountBase.toString()).toBe('50');
      expect(data).toMatchObject({ orderId: 'ord1', paymentId: 'pay1', toWallet: true, requestedById: 'admin' });
      expect(data.fxRate).toBe(order.fxRate);
    });

    it('creates a partial refund for an explicit amount', async () => {
      await service.request('ord1', 30, 'partial', 'admin');
      const data = prisma.refund.create.mock.calls[0][0].data;
      expect(data.amount.toString()).toBe('30');
      expect(data.toWallet).toBe(false);
    });

    it('rejects a non-positive computed refund (already fully refunded)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...order,
        refunds: [{ status: RefundStatus.PROCESSED, amount: new Prisma.Decimal('100') }],
      });
      await expect(service.request('ord1', undefined, 'x', 'admin')).rejects.toThrow('must be positive');
    });

    it('rejects a refund that would exceed the order total', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...order,
        refunds: [{ status: RefundStatus.PROCESSED, amount: new Prisma.Decimal('80') }],
      });
      await expect(service.request('ord1', 30, 'x', 'admin')).rejects.toThrow('exceeds order total');
    });
  });

  describe('process', () => {
    const cardRefund = {
      id: 'ref1',
      status: RefundStatus.REQUESTED,
      toWallet: false,
      orderId: 'ord1',
      paymentId: 'pay1',
      amount: new Prisma.Decimal('100'),
      currency: 'USD',
      reason: 'defective',
      order: { userId: 'usr1', orderNumber: 'ORD-1000', total: new Prisma.Decimal('100') },
      payment: { gateway: 'STRIPE', gatewayRef: 'pi_1' },
    };

    it('throws NotFound for a missing refund', async () => {
      prisma.refund.findUnique.mockResolvedValue(null);
      await expect(service.process('ref1', 'admin')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is idempotent when the refund is already processed', async () => {
      const done = { ...cardRefund, status: RefundStatus.PROCESSED };
      prisma.refund.findUnique.mockResolvedValue(done);
      await expect(service.process('ref1', 'admin')).resolves.toBe(done);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses to process a rejected refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({ ...cardRefund, status: RefundStatus.REJECTED });
      await expect(service.process('ref1', 'admin')).rejects.toThrow('was rejected');
    });

    it('calls the gateway for a card refund, then settles the transaction fully', async () => {
      prisma.refund.findUnique.mockResolvedValue(cardRefund);

      const res = await service.process('ref1', 'admin');

      expect(gateways.get).toHaveBeenCalledWith('STRIPE');
      expect(gateway.refund).toHaveBeenCalledWith(
        expect.objectContaining({ gatewayRef: 'pi_1', amount: cardRefund.amount, currency: 'USD' }),
      );
      // wallet lock is taken unconditionally even for a card refund
      expect(wallet.lockWallet).toHaveBeenCalledWith('usr1', 'USD', tx);
      expect(wallet.credit).not.toHaveBeenCalled();
      expect(tx.refund.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: RefundStatus.PROCESSED, gatewayRef: 're_1' }) }),
      );
      // full refund flips payment to REFUNDED and the order to REFUNDED
      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REFUNDED' }) }),
      );
      expect(tx.orderItem.updateMany).toHaveBeenCalled();
      expect(outbox.emit).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'refund.processed' }));
      expect(tx.auditLog.create).toHaveBeenCalled();
      expect(res).toEqual({ id: 'ref1', status: 'PROCESSED' });
    });

    it('credits the wallet and skips the gateway for a wallet refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        ...cardRefund, toWallet: true,
      });

      await service.process('ref1', 'admin');

      expect(gateway.refund).not.toHaveBeenCalled();
      expect(wallet.credit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'usr1', currency: 'USD', type: WalletTxnType.REFUND, createdById: 'admin' }),
        tx,
      );
    });

    it('does not call the gateway when a card refund has no gatewayRef', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        ...cardRefund, payment: { gateway: 'STRIPE', gatewayRef: null },
      });
      await service.process('ref1', 'admin');
      expect(gateway.refund).not.toHaveBeenCalled();
    });

    it('leaves the order open and marks the payment PARTIALLY_REFUNDED on a partial refund', async () => {
      prisma.refund.findUnique.mockResolvedValue({ ...cardRefund, amount: new Prisma.Decimal('40') });
      tx.refund.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal('40') } });

      await service.process('ref1', 'admin');

      expect(tx.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PARTIALLY_REFUNDED' }) }),
      );
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(tx.orderItem.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a concurrent claim when the conditional update matches nothing', async () => {
      prisma.refund.findUnique.mockResolvedValue(cardRefund);
      tx.refund.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.process('ref1', 'admin')).rejects.toThrow('already being processed');
    });

    it('handles a refund with no linked payment', async () => {
      prisma.refund.findUnique.mockResolvedValue({
        ...cardRefund, toWallet: true, paymentId: null, payment: null,
      });
      await service.process('ref1', 'admin');
      expect(tx.payment.update).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('marks the refund rejected and truncates the reason to 500 chars', async () => {
      const longReason = 'x'.repeat(600);
      await service.reject('ref1', 'admin', longReason);
      const data = prisma.refund.update.mock.calls[0][0].data;
      expect(data.status).toBe(RefundStatus.REJECTED);
      expect(data.processedById).toBe('admin');
      expect(data.reason).toHaveLength(500);
    });
  });

  describe('findAll', () => {
    it('filters by status when provided', async () => {
      await service.findAll(RefundStatus.REQUESTED);
      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: RefundStatus.REQUESTED }, take: 100 }),
      );
    });

    it('returns all refunds when no status is provided', async () => {
      await service.findAll();
      expect(prisma.refund.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
    });
  });
});
