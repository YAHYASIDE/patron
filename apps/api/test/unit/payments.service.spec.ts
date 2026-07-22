import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('PaymentsService', () => {
  let prisma: any;
  let gateways: any;
  let gateway: any;
  let outbox: any;
  let metrics: any;
  let service: PaymentsService;
  let tx: any;

  const order = {
    id: 'ord1',
    userId: 'usr1',
    status: 'PENDING_PAYMENT',
    total: new Prisma.Decimal('100'),
    totalBase: new Prisma.Decimal('50'),
    currency: 'USD',
    baseCurrency: 'USD',
    fxRate: new Prisma.Decimal('2'),
    fxRateId: 'fx1',
    orderNumber: 'ORD-1000',
  };

  beforeEach(() => {
    tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      payment: {
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pay1' }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      inboundWebhook: {
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    gateway = {
      initiate: jest.fn(),
      verify: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      parseWebhook: jest.fn(),
    };
    gateways = { get: jest.fn(() => gateway), listCodes: jest.fn().mockReturnValue(['WALLET', 'STRIPE']) };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    metrics = {
      paymentsTotal: { inc: jest.fn() },
      orderValue: { inc: jest.fn() },
      webhooksTotal: { inc: jest.fn() },
    };
    service = new PaymentsService(prisma, gateways, outbox, metrics);
  });

  describe('initiate', () => {
    it('throws NotFound when the order does not exist', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.initiate('ord1', 'usr1', 'STRIPE' as any)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects an order owned by another account', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...order, userId: 'other' });
      await expect(service.initiate('ord1', 'usr1', 'STRIPE' as any)).rejects.toThrow('another account');
    });

    it('rejects an order that is not awaiting payment', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...order, status: 'PAID' });
      await expect(service.initiate('ord1', 'usr1', 'STRIPE' as any)).rejects.toThrow('not awaiting payment');
    });

    it('reuses an in-flight attempt on the same gateway when it is still pending', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay0',
        status: 'AUTHORIZED',
        gateway: 'STRIPE',
        gatewayRef: 'pi_0',
      });
      gateway.verify.mockResolvedValue({ status: 'PENDING' });

      const res = await service.initiate('ord1', 'usr1', 'STRIPE' as any);

      expect(res).toEqual({ paymentId: 'pay0', status: 'AUTHORIZED', gatewayRef: 'pi_0' });
      expect(gateway.verify).toHaveBeenCalledWith('pi_0');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('creates a new payment when the in-flight attempt is no longer pending', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay0', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'pi_0',
      });
      gateway.verify.mockResolvedValue({ status: 'FAILED' });
      gateway.initiate.mockResolvedValue({ status: 'REQUIRES_ACTION', gatewayRef: 'pi_1' });

      const res = await service.initiate('ord1', 'usr1', 'STRIPE' as any);

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'REQUIRES_ACTION' });
    });

    it('creates a payment and returns REQUIRES_ACTION for a redirect gateway', async () => {
      gateway.initiate.mockResolvedValue({
        status: 'REQUIRES_ACTION', gatewayRef: 'pi_1', redirectUrl: 'https://r', clientSecret: 'cs',
      });

      const res = await service.initiate('ord1', 'usr1', 'STRIPE' as any, 'https://return');

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 'ord1', userId: 'usr1', gateway: 'STRIPE',
            amount: order.total, status: 'INITIATED',
          }),
        }),
      );
      // amount is taken from the order, and the returnUrl is forwarded to the gateway
      expect(gateway.initiate).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: 'pay1', amount: order.total, returnUrl: 'https://return' }),
      );
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'AUTHORIZED', gatewayRef: 'pi_1' }) }),
      );
      expect(res).toEqual({
        paymentId: 'pay1', status: 'REQUIRES_ACTION', gatewayRef: 'pi_1',
        redirectUrl: 'https://r', clientSecret: 'cs',
      });
    });

    it('marks the payment FAILED and throws when the gateway declines', async () => {
      gateway.initiate.mockResolvedValue({
        status: 'FAILED', failureCode: 'insufficient_funds', failureReason: 'No balance',
      });

      await expect(service.initiate('ord1', 'usr1', 'WALLET' as any)).rejects.toThrow('No balance');
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'FAILED', failureCode: 'insufficient_funds' }),
        }),
      );
    });

    it('captures immediately for an instant gateway', async () => {
      gateway.initiate.mockResolvedValue({ status: 'CAPTURED', gatewayRef: 'wallet_pay1', raw: { ok: 1 } });
      const spy = jest.spyOn(service, 'markCaptured').mockResolvedValue({ alreadyCaptured: false } as any);

      const res = await service.initiate('ord1', 'usr1', 'WALLET' as any);

      expect(spy).toHaveBeenCalledWith('pay1', 'wallet_pay1', { ok: 1 });
      expect(res).toEqual({ paymentId: 'pay1', status: 'CAPTURED', gatewayRef: 'wallet_pay1' });
    });
  });

  describe('confirm', () => {
    it('short-circuits when the payment is already captured', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ status: 'CAPTURED' });
      await expect(service.confirm('pay1')).resolves.toEqual({ status: 'CAPTURED' });
      expect(gateway.verify).not.toHaveBeenCalled();
    });

    it('rejects a payment never submitted to a gateway', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ status: 'INITIATED', gatewayRef: null });
      await expect(service.confirm('pay1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('captures when the gateway reports success', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay1', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'pi_1' });
      gateway.verify.mockResolvedValue({ status: 'CAPTURED', raw: { r: 1 } });
      const spy = jest.spyOn(service, 'markCaptured').mockResolvedValue({ alreadyCaptured: false } as any);

      await expect(service.confirm('pay1')).resolves.toEqual({ status: 'CAPTURED' });
      expect(spy).toHaveBeenCalledWith('pay1', 'pi_1', { r: 1 });
    });

    it('marks FAILED when the gateway reports failure', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay1', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'pi_1' });
      gateway.verify.mockResolvedValue({ status: 'FAILED', raw: { r: 0 } });

      await expect(service.confirm('pay1')).resolves.toEqual({ status: 'FAILED' });
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
    });

    it('returns PENDING when the gateway is undecided', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay1', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'pi_1' });
      gateway.verify.mockResolvedValue({ status: 'PENDING' });
      await expect(service.confirm('pay1')).resolves.toEqual({ status: 'PENDING' });
    });
  });

  describe('markCaptured', () => {
    beforeEach(() => {
      tx.payment.findUniqueOrThrow
        .mockResolvedValueOnce({ orderId: 'ord1' })
        .mockResolvedValueOnce({
          orderId: 'ord1', userId: 'usr1', gateway: 'STRIPE',
          currency: 'USD', amountBase: new Prisma.Decimal('50'),
          order: { status: 'PENDING_PAYMENT' },
        });
    });

    it('captures, moves the order to PAID, emits an outbox event and records metrics', async () => {
      const res = await service.markCaptured('pay1', 'pi_1', { raw: 1 });

      expect(res).toEqual({ alreadyCaptured: false });
      expect(tx.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'pay1' }),
          data: expect.objectContaining({ status: 'CAPTURED', gatewayRef: 'pi_1' }),
        }),
      );
      expect(tx.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }),
      );
      expect(outbox.emit).toHaveBeenCalledWith(tx, expect.objectContaining({ eventType: 'order.paid' }));
      expect(metrics.paymentsTotal.inc).toHaveBeenCalledWith({ gateway: 'STRIPE', status: 'captured' });
      expect(metrics.orderValue.inc).toHaveBeenCalledWith({ currency: 'USD' }, 50);
    });

    it('is a no-op when a replayed capture claims nothing', async () => {
      tx.payment.updateMany.mockResolvedValue({ count: 0 });

      const res = await service.markCaptured('pay1', 'pi_1');

      expect(res).toEqual({ alreadyCaptured: true });
      expect(tx.order.update).not.toHaveBeenCalled();
      expect(outbox.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    const parsed = { eventId: 'evt_1', gatewayRef: 'pi_1', status: 'CAPTURED' as const };

    beforeEach(() => {
      gateway.parseWebhook.mockReturnValue(parsed);
      prisma.payment.findUnique.mockResolvedValue({ id: 'pay1' });
    });

    it('rejects an invalid signature before any processing', async () => {
      gateway.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handleWebhook('stripe', 'raw', {}, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(gateways.get).toHaveBeenCalledWith('STRIPE');
    });

    it('ignores an event the gateway cannot parse', async () => {
      gateway.parseWebhook.mockReturnValue(null);
      await expect(service.handleWebhook('stripe', 'raw', {}, {})).resolves.toEqual({ ignored: true });
    });

    it('detects a duplicate via the unique constraint', async () => {
      const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.0.0' } as any);
      prisma.inboundWebhook.create.mockRejectedValue(dup);

      await expect(service.handleWebhook('stripe', 'raw', {}, {})).resolves.toEqual({ duplicate: true });
      expect(metrics.webhooksTotal.inc).toHaveBeenCalledWith({ source: 'stripe', result: 'duplicate' });
    });

    it('rethrows non-duplicate persistence errors', async () => {
      prisma.inboundWebhook.create.mockRejectedValue(new Error('db down'));
      await expect(service.handleWebhook('stripe', 'raw', {}, {})).rejects.toThrow('db down');
    });

    it('returns unmatched when no payment maps to the gatewayRef', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(service.handleWebhook('stripe', 'raw', {}, {})).resolves.toEqual({ unmatched: true });
    });

    it('captures on a success webhook and marks it processed', async () => {
      const spy = jest.spyOn(service, 'markCaptured').mockResolvedValue({ alreadyCaptured: false } as any);
      const payload = { some: 'payload' };

      const res = await service.handleWebhook('stripe', 'raw', {}, payload);

      expect(spy).toHaveBeenCalledWith('pay1', 'pi_1', payload);
      expect(prisma.inboundWebhook.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }),
      );
      expect(res).toEqual({ processed: true });
    });

    it('fails the payment on a non-capture webhook', async () => {
      gateway.parseWebhook.mockReturnValue({ ...parsed, status: 'FAILED' });

      const res = await service.handleWebhook('stripe', 'raw', {}, { p: 1 });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(res).toEqual({ processed: true });
    });
  });

  describe('availableMethods', () => {
    it('delegates to the gateway registry', () => {
      expect(service.availableMethods()).toEqual(['WALLET', 'STRIPE']);
      expect(gateways.listCodes).toHaveBeenCalled();
    });
  });
});
