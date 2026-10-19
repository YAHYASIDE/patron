import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';

/**
 * The audit's most serious finding: four wallet payments for the same order
 * sent at the same moment (two taps, two tabs, a retry after a dropped
 * connection — each with its own Idempotency-Key) took the money four times.
 * The order must be paid once and the wallet debited once, however many
 * requests race.
 */
describe('Paying one order from the wallet, concurrently', () => {
  let prisma: PrismaService;
  let wallet: WalletService;
  let payments: PaymentsService;
  let userId: string;
  let orderId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    wallet = new WalletService(prisma);
    const metrics = { paymentsTotal: { inc: jest.fn() }, orderValue: { inc: jest.fn() }, webhooksTotal: { inc: jest.fn() } };
    payments = new PaymentsService(
      prisma, {} as any, new OutboxService(prisma), metrics as any, { record: jest.fn() } as any, {} as any, {} as any, wallet,
    );
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    await prisma.currency.upsert({
      where: { code: 'MRU' }, update: {},
      create: { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', decimals: 0 },
    });
    const user = await prisma.user.create({
      data: { email: `wpay-${Date.now()}-${Math.random()}@test.local`, fullName: 'Wallet Payer', passwordHash: 'x' },
    });
    userId = user.id;
    await prisma.$transaction((tx) =>
      wallet.credit({ userId, currency: 'MRU', amount: 1000, type: 'ADMIN_ADJUSTMENT' }, tx),
    );
    const order = await prisma.order.create({
      data: {
        orderNumber: `PTN-W-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, userId, status: 'PENDING_PAYMENT',
        subtotal: 40, total: 40, currency: 'MRU', baseCurrency: 'USD', fxRate: 39.8, totalBase: 1.01,
      },
    });
    orderId = order.id;
  });

  const pay = () => payments.initiate(orderId, userId, 'WALLET' as any);

  it.each([2, 4, 8])('%i simultaneous payments take the money once and pay the order once', async (n) => {
    const results = await Promise.allSettled(Array.from({ length: n }, pay));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(String(r.reason)).toMatch(/not awaiting payment/);
    }

    const captured = await prisma.payment.count({ where: { orderId, status: 'CAPTURED' } });
    expect(captured).toBe(1);
    const debits = await prisma.walletTransaction.findMany({ where: { userId, type: 'ORDER_PAYMENT' } });
    expect(debits).toHaveLength(1);
    const balance = await prisma.wallet.findFirstOrThrow({ where: { userId, currencyCode: 'MRU' } });
    expect(Number(balance.balance)).toBe(960);
    const paidEvents = await prisma.outboxEvent.count({ where: { aggregateId: orderId, eventType: 'order.paid' } });
    expect(paidEvents).toBe(1);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PAID');
    expect(await wallet.findDrift()).toHaveLength(0);
  });

  it('leaves no payment row and no debit when the balance is short', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { subtotal: 5000, total: 5000 } });

    await expect(pay()).rejects.toThrow(/Insufficient wallet balance/);

    expect(await prisma.payment.count({ where: { orderId } })).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { userId, type: 'ORDER_PAYMENT' } })).toBe(0);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('PENDING_PAYMENT');
  });

  it('refuses, at the database, a second settled payment for the same order', async () => {
    await pay();
    await expect(
      prisma.payment.create({
        data: {
          orderId, userId, gateway: 'STRIPE', amount: 40, currency: 'MRU', baseCurrency: 'USD',
          fxRate: 39.8, amountBase: 1.01, status: 'CAPTURED', gatewayRef: `pi_dup_${Date.now()}`,
        },
      }),
    ).rejects.toThrow();
  });
});
