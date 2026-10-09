import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';

/**
 * A payment gateway will deliver the same webhook more than once — that is the
 * documented contract, not a fault. Processing it twice would fulfil an order
 * twice and pay a provider twice.
 */
describe('Payment capture idempotency', () => {
  let prisma: PrismaService;
  let payments: PaymentsService;
  let metrics: any;
  let orderId: string;
  let paymentId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    metrics = {
      paymentsTotal: { inc: jest.fn() },
      orderValue: { inc: jest.fn() },
      webhooksTotal: { inc: jest.fn() },
    };
    payments = new PaymentsService(prisma, {} as any, new OutboxService(prisma), metrics);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'د', nameEn: 'USD', symbol: '$', isBase: true },
    });
    const user = await prisma.user.create({
      data: { email: `pay-${Date.now()}@test.local`, fullName: 'Payer', passwordHash: 'x' },
    });
    const order = await prisma.order.create({
      data: {
        orderNumber: `PTN-${Date.now()}`, userId: user.id, status: 'PENDING_PAYMENT',
        subtotal: 25, total: 25, currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase: 25,
      },
    });
    orderId = order.id;

    const payment = await prisma.payment.create({
      data: {
        orderId, userId: user.id, gateway: 'STRIPE', amount: 25, currency: 'USD',
        baseCurrency: 'USD', fxRate: 1, amountBase: 25, status: 'AUTHORIZED', gatewayRef: `pi_${Date.now()}`,
      },
    });
    paymentId = payment.id;
  });

  it('captures once and moves the order to PAID', async () => {
    const result = await payments.markCaptured(paymentId, 'pi_ref');

    expect(result.alreadyCaptured).toBe(false);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');
    expect(order.paidAt).not.toBeNull();
  });

  it('is a no-op on a replayed capture', async () => {
    await payments.markCaptured(paymentId, 'pi_ref');
    const second = await payments.markCaptured(paymentId, 'pi_ref');

    expect(second.alreadyCaptured).toBe(true);
  });

  it('emits exactly one fulfilment event no matter how often the webhook arrives', async () => {
    await payments.markCaptured(paymentId, 'pi_ref');
    await payments.markCaptured(paymentId, 'pi_ref');
    await payments.markCaptured(paymentId, 'pi_ref');

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: orderId, eventType: 'order.paid' },
    });
    expect(events).toHaveLength(1);
  });

  it('survives concurrent captures without double-emitting', async () => {
    await Promise.allSettled([
      payments.markCaptured(paymentId, 'pi_ref'),
      payments.markCaptured(paymentId, 'pi_ref'),
    ]);

    const events = await prisma.outboxEvent.findMany({
      where: { aggregateId: orderId, eventType: 'order.paid' },
    });
    expect(events).toHaveLength(1);
  });

  it('rejects a duplicate webhook at the database level', async () => {
    const create = () =>
      prisma.inboundWebhook.create({
        data: { source: 'stripe', eventId: 'evt_dup', eventType: 'CAPTURED', payload: {} },
      });

    await create();
    await expect(create()).rejects.toThrow();
  });

  it('rolls the whole capture back if the order transition is illegal', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'CANCELLED' } });

    await expect(payments.markCaptured(paymentId, 'pi_ref')).rejects.toThrow(/Illegal order transition/);

    // The payment must not be left CAPTURED against a cancelled order.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('AUTHORIZED');
  });
});
