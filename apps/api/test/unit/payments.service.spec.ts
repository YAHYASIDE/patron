import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('PaymentsService', () => {
  let audit: any;
  let manual: any;
  let uploads: any;
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
      notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }), findFirst: jest.fn().mockResolvedValue(null) },
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
    gateways = {
      get: jest.fn(() => gateway),
      listCodes: jest.fn().mockReturnValue(['WALLET', 'STRIPE']),
      listEnabledCodes: jest.fn().mockResolvedValue(['WALLET', 'MANUAL']),
    };
    outbox = { emit: jest.fn().mockResolvedValue(undefined) };
    metrics = {
      paymentsTotal: { inc: jest.fn() },
      orderValue: { inc: jest.fn() },
      webhooksTotal: { inc: jest.fn() },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    manual = {
      accounts: jest.fn().mockResolvedValue([
        { id: 'acc1', method: 'Bankily', countries: ['MR'], accountName: 'Patron', accountNumber: '22233344', kind: 'mobile', enabled: true },
        { id: 'off1', method: 'Moov Money', countries: ['ML'], accountName: '', accountNumber: '', kind: 'mobile', enabled: false },
      ]),
    };
    uploads = {
      hasProof: jest.fn().mockResolvedValue(true),
      saveProof: jest.fn().mockResolvedValue({ proofId: 'up1' }),
      getProof: jest.fn().mockResolvedValue({ mime: 'image/jpeg', data: Buffer.from('x') }),
    };
    service = new PaymentsService(prisma, gateways, outbox, metrics, audit, manual, uploads);
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

      expect(res).toEqual({ paymentId: 'pay0', status: 'AUTHORIZED', gatewayRef: 'pi_0', redirectUrl: undefined });
      expect(gateway.verify).toHaveBeenCalledWith('pi_0');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('sends the customer back to a card page that is still open', async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: 'pay0', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'cs_0' });
      gateway.verify.mockResolvedValue({ status: 'PENDING' });
      gateway.resumeUrl = jest.fn().mockResolvedValue('https://checkout/cs_0');

      const res = await service.initiate('ord1', 'usr1', 'STRIPE' as any);

      expect(res).toEqual({ paymentId: 'pay0', status: 'AUTHORIZED', gatewayRef: 'cs_0', redirectUrl: 'https://checkout/cs_0' });
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('opens a new card page when the old one can no longer be used', async () => {
      prisma.payment.findFirst.mockResolvedValue({ id: 'pay0', status: 'AUTHORIZED', gateway: 'STRIPE', gatewayRef: 'cs_0' });
      gateway.verify.mockResolvedValue({ status: 'PENDING' });
      gateway.resumeUrl = jest.fn().mockResolvedValue(undefined);
      gateway.initiate.mockResolvedValue({ status: 'REQUIRES_ACTION', gatewayRef: 'cs_1', redirectUrl: 'https://checkout/cs_1' });

      const res = await service.initiate('ord1', 'usr1', 'STRIPE' as any);

      expect(prisma.payment.create).toHaveBeenCalled();
      expect(res).toMatchObject({ status: 'REQUIRES_ACTION', redirectUrl: 'https://checkout/cs_1' });
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
    it('lists only the gateways that are enabled right now', async () => {
      await expect(service.availableMethods()).resolves.toEqual(['WALLET', 'MANUAL']);
      expect(gateways.listEnabledCodes).toHaveBeenCalled();
    });
  });

  describe('manual transfer', () => {
    const manualPayment = (over: Partial<any> = {}) => ({
      id: 'pay1', userId: 'u1', gateway: 'MANUAL', status: 'INITIATED', gatewayRef: 'manual_pay1',
      rawResponse: null, order: { status: 'PENDING_PAYMENT' }, ...over,
    });

    it('keeps a manual payment INITIATED until the customer submits a reference', async () => {
      gateway.awaitsCustomerProof = true;
      gateway.initiate.mockResolvedValue({ status: 'REQUIRES_ACTION', gatewayRef: 'manual_pay1' });

      const res = await service.initiate('ord1', 'usr1', 'MANUAL' as any);

      expect(res.status).toBe('REQUIRES_ACTION');
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'INITIATED', gatewayRef: 'manual_pay1' }) }),
      );
    });

    it('records the reported transfer and moves the payment to AUTHORIZED', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment());
      const res = await service.submitTransfer('pay1', 'u1', { accountId: 'acc1', reference: ' TX-998 ', payerPhone: '22244455' });

      expect(res).toEqual({ paymentId: 'pay1', status: 'AUTHORIZED' });
      const data = prisma.payment.update.mock.calls[0][0].data;
      expect(data.status).toBe('AUTHORIZED');
      expect(data.rawResponse.transfer).toEqual(expect.objectContaining({ method: 'Bankily', reference: 'TX-998', payerPhone: '22244455' }));
    });

    it("refuses another customer's payment, a non-manual payment, a reviewed one and an unknown or switched-off account", async () => {
      const dto = (accountId = 'acc1') => ({ accountId, payerPhone: '22244455' });
      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ userId: 'someone-else' }));
      await expect(service.submitTransfer('pay1', 'u1', dto())).rejects.toThrow('another account');

      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ gateway: 'STRIPE' }));
      await expect(service.submitTransfer('pay1', 'u1', dto())).rejects.toThrow('manual transfer');

      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ status: 'CAPTURED' }));
      await expect(service.submitTransfer('pay1', 'u1', dto())).rejects.toThrow('already been reviewed');

      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment());
      await expect(service.submitTransfer('pay1', 'u1', dto('nope'))).rejects.toThrow('Unknown transfer account');

      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment());
      await expect(service.submitTransfer('pay1', 'u1', dto('off1'))).rejects.toThrow('Unknown transfer account');
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('needs a screenshot of the transfer before it can be reported', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment());
      uploads.hasProof.mockResolvedValueOnce(false);
      await expect(service.submitTransfer('pay1', 'u1', { accountId: 'acc1', payerPhone: '22244455' })).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'PROOF_REQUIRED' }),
      });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('takes a receipt only from the payer, for an unreviewed manual payment', async () => {
      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment());
      const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3 };
      await expect(service.attachProof('pay1', 'u1', file)).resolves.toEqual({ proofId: 'up1' });
      expect(uploads.saveProof).toHaveBeenCalledWith('pay1', file, 'u1');

      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.attachProof('pay1', 'u1', file)).rejects.toBeInstanceOf(NotFoundException);
      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ userId: 'other' }));
      await expect(service.attachProof('pay1', 'u1', file)).rejects.toThrow('another account');
      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ gateway: 'WALLET' }));
      await expect(service.attachProof('pay1', 'u1', file)).rejects.toThrow('receipt');
      prisma.payment.findUnique.mockResolvedValueOnce(manualPayment({ status: 'FAILED' }));
      await expect(service.attachProof('pay1', 'u1', file)).rejects.toThrow('already been reviewed');
      expect(uploads.saveProof).toHaveBeenCalledTimes(1);
    });

    it('lets staff open the receipt', async () => {
      await expect(service.proof('pay1')).resolves.toEqual(expect.objectContaining({ mime: 'image/jpeg' }));
      expect(uploads.getProof).toHaveBeenCalledWith('pay1');
    });

    it('shows customers only usable accounts, and the dashboard all of them', async () => {
      prisma.systemSetting = { findUnique: jest.fn().mockResolvedValue(null) };
      expect((await service.manualInstructions()).accounts.map((a) => a.id)).toEqual(['acc1']);
      expect((await service.manualInstructions(true)).accounts.map((a) => a.id)).toEqual(['acc1', 'off1']);
    });

    it('approving captures the payment exactly like a gateway capture, and is audited', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'AUTHORIZED', rawResponse: { transfer: { reference: 'TX1' } } }));
      const capture = jest.spyOn(service, 'markCaptured').mockResolvedValue({ alreadyCaptured: false });

      await expect(service.approveManual('pay1', 'admin1')).resolves.toEqual({ status: 'CAPTURED' });
      expect(capture).toHaveBeenCalledWith('pay1', 'manual_pay1', expect.objectContaining({ transfer: { reference: 'TX1' }, review: expect.objectContaining({ decision: 'approved', by: 'admin1' }) }));
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'payments.manual.approve' }));
    });

    it('will not approve before the customer reported the transfer', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'INITIATED' }));
      const capture = jest.spyOn(service, 'markCaptured');
      await expect(service.approveManual('pay1', 'admin1')).rejects.toThrow('submitted its reference');
      expect(capture).not.toHaveBeenCalled();
    });

    it('rejecting fails the payment with the reason, so the customer can pay again', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'AUTHORIZED' }));
      await expect(service.rejectManual('pay1', 'No transfer found', 'admin1')).resolves.toEqual({ status: 'FAILED' });
      const call = prisma.payment.updateMany.mock.calls[0][0];
      expect(call.where.status).toEqual({ in: ['INITIATED', 'AUTHORIZED'] });
      expect(call.data).toEqual(expect.objectContaining({ status: 'FAILED', failureCode: 'rejected_by_staff', failureReason: 'No transfer found' }));
    });

    it('rejecting tells the customer why, with a link back to the order', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'AUTHORIZED', orderId: 'ord1' }));
      await service.rejectManual('pay1', 'No transfer found', 'admin1');
      const { data } = tx.notification.create.mock.calls[0][0];
      expect(data).toEqual(expect.objectContaining({ userId: 'u1', channel: 'IN_APP' }));
      expect(data.bodyAr).toContain('ORD-1000');
      expect(data.bodyEn).toContain('No transfer found');
      expect(data.data).toEqual(expect.objectContaining({
        type: 'payment.rejected', orderId: 'ord1', link: '/orders/ord1', reason: 'No transfer found',
        fr: expect.objectContaining({ title: 'Virement non confirmé' }),
      }));
    });

    it('still notifies when the order number cannot be read', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'AUTHORIZED', orderId: 'ord1' }));
      await service.rejectManual('pay1', 'No transfer found', 'admin1');
      expect(tx.notification.create).toHaveBeenCalledTimes(1);
    });

    it('a second review of the same payment is refused', async () => {
      prisma.payment.findUnique.mockResolvedValue(manualPayment({ status: 'CAPTURED' }));
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.rejectManual('pay1', 'late', 'admin1')).rejects.toThrow('already been reviewed');
    });

    it('saves the owner accounts with ids and returns what customers will see', async () => {
      tx.systemSetting = { upsert: jest.fn().mockResolvedValue({}) };
      prisma.systemSetting = { findUnique: jest.fn().mockResolvedValue({ value: 'Send the order number as the reason' }) };

      const res = await service.setManualInstructions(
        { accounts: [{ method: ' Masrvi ', country: 'mr', accountName: 'Patron', accountNumber: '4455' }], note: 'Send the order number as the reason' },
        'admin1',
      );
      const saved = tx.systemSetting.upsert.mock.calls[0][0].create.value;
      expect(saved[0]).toEqual(expect.objectContaining({ method: 'Masrvi', countries: ['MR'], accountNumber: '4455', kind: 'mobile', enabled: true }));
      expect(saved[0].id).toEqual(expect.any(String));
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'payments.manual_accounts.update' }));
      expect(res.note).toBe('Send the order number as the reason');
    });

    it('saves several countries, the kind and the logo, and keeps a numberless method switched off', async () => {
      tx.systemSetting = { upsert: jest.fn().mockResolvedValue({}) };
      prisma.systemSetting = { findUnique: jest.fn().mockResolvedValue(null) };
      await service.setManualInstructions(
        {
          accounts: [
            { method: 'Binance Pay', countries: ['mr', 'XX', 'MR'], accountNumber: ' 123456789 ', kind: 'crypto', logo: 'binance' },
            { method: 'Moov Money', countries: ['ML'], accountNumber: '', enabled: false },
          ],
        },
        'admin1',
      );
      const saved = tx.systemSetting.upsert.mock.calls[0][0].create.value;
      expect(saved[0]).toEqual(expect.objectContaining({ countries: ['MR', 'XX'], accountNumber: '123456789', kind: 'crypto', logo: 'binance', enabled: true }));
      expect(saved[1]).toEqual(expect.objectContaining({ enabled: false, accountNumber: '' }));
    });

    it('refuses a switched-on method without a number to pay to', async () => {
      await expect(
        service.setManualInstructions({ accounts: [{ method: 'Nita', countries: ['NE'], accountNumber: '' }] }, 'admin1'),
      ).rejects.toMatchObject({ response: expect.objectContaining({ error: 'ACCOUNT_NUMBER_REQUIRED' }) });
    });
  });
});
