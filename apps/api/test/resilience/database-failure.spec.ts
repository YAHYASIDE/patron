import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';

/**
 * Transaction safety and recovery.
 *
 * The question these answer: after a crash at the worst possible moment, is the
 * database in a state a human can reason about — or has money vanished?
 */
describe('Database failure and recovery', () => {
  let prisma: PrismaService;
  let outbox: OutboxService;
  let wallet: WalletService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    outbox = new OutboxService(prisma);
    wallet = new WalletService(prisma);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'د', nameEn: 'USD', symbol: '$', isBase: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `dbf-${Date.now()}-${Math.random()}@test.local`, fullName: 'DB', passwordHash: 'x',
        wallets: { create: { currencyCode: 'USD', balance: 100 } },
      },
    });
    userId = user.id;
  });

  it('leaves no partial state when a transaction fails midway', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await wallet.debit({ userId, currency: 'USD', amount: 50, type: 'ORDER_PAYMENT' }, tx);
        await outbox.emit(tx, { aggregate: 'Order', aggregateId: 'x', eventType: 'order.paid', payload: {} });
        throw new Error('crash after the debit');
      }),
    ).rejects.toThrow('crash after the debit');

    const w = await prisma.wallet.findFirstOrThrow({ where: { userId } });
    const ledger = await prisma.walletTransaction.count({ where: { userId } });
    const events = await outbox.claimBatch();

    expect(Number(w.balance)).toBe(100); // untouched
    expect(ledger).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('rejects a ledger write that would break the balance invariant', async () => {
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId } });

    // Simulating a bug that writes the ledger directly with inconsistent maths.
    await expect(
      prisma.walletTransaction.create({
        data: {
          walletId: w.id, userId, type: 'ADMIN_ADJUSTMENT', currency: 'USD',
          amount: 10, balanceBefore: 100, balanceAfter: 999, // 100 + 10 ≠ 999
        },
      }),
    ).rejects.toThrow();
  });

  it('refuses to let a balance go negative even by direct write', async () => {
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId } });
    await expect(
      prisma.wallet.update({ where: { id: w.id }, data: { balance: -1 } }),
    ).rejects.toThrow();
  });

  it('recovers pending outbox events after a simulated process crash', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'crash-1', eventType: 'order.paid', payload: {} }),
    );

    // A relay claimed the event and then died before marking it published.
    const [claimed] = await outbox.claimBatch();
    expect(claimed).toBeDefined();
    await outbox.markFailed(claimed.id, 1, 'process died');

    // It must become claimable again rather than being stranded.
    await prisma.outboxEvent.update({
      where: { id: claimed.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    const redelivered = await outbox.claimBatch();
    expect(redelivered.map((e) => e.id)).toContain(claimed.id);
  });

  it('detects drift when a balance is written outside the ledger', async () => {
    const w = await prisma.wallet.findFirstOrThrow({ where: { userId } });
    await prisma.wallet.update({ where: { id: w.id }, data: { balance: 42 } });

    const drift = await wallet.findDrift();
    expect(drift.some((d) => d.walletId === w.id)).toBe(true);
  });

  it('enforces the order total invariant at the database level', async () => {
    await expect(
      prisma.order.create({
        data: {
          orderNumber: `BAD-${Date.now()}`, userId, status: 'PENDING_PAYMENT',
          subtotal: 10, discount: 0, fees: 0, taxAmount: 0,
          total: 999, // ≠ subtotal - discount + fees + tax
          currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase: 999,
        },
      }),
    ).rejects.toThrow();
  });
});
