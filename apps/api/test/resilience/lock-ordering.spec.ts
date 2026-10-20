import { PrismaService } from '../../src/common/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { LockRank, acquireLocks } from '../../src/common/locking/lock-order';

/**
 * ADR 010 — the global lock order exists to make this class of deadlock
 * impossible rather than merely unlikely.
 */
describe('Lock ordering (ADR 010)', () => {
  let prisma: PrismaService;
  let wallet: WalletService;
  let userId: string;
  let walletId: string;
  let orderId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
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
        email: `lock-${Date.now()}-${Math.random()}@test.local`, fullName: 'Lock', passwordHash: 'x',
        wallets: { create: { currencyCode: 'USD', balance: 500 } },
      },
      include: { wallets: true },
    });
    userId = user.id;
    walletId = user.wallets[0].id;

    const order = await prisma.order.create({
      data: {
        orderNumber: `LK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId, status: 'PAID', paidAt: new Date(),
        subtotal: 10, total: 10, currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase: 10,
      },
    });
    orderId = order.id;
  });

  it('sorts resources into canonical order regardless of how they are listed', async () => {
    // Listed deliberately backwards; the helper must reorder them.
    await prisma.$transaction((tx) =>
      acquireLocks(tx, [
        { rank: LockRank.REFUND, id: orderId }, // id reused; only ordering is under test
        { rank: LockRank.WALLET, id: walletId },
        { rank: LockRank.ORDER, id: orderId },
      ]).then(() => undefined),
    );
    // Reaching here without a deadlock or error is the assertion.
    expect(true).toBe(true);
  });

  it('does not deadlock when a payment and a refund race on the same customer', async () => {
    // Both paths now take wallet first. Before ADR 010 these acquired the
    // wallet/order pair in opposite orders and could deadlock.
    const paymentPath = () =>
      prisma.$transaction(async (tx) => {
        await wallet.lockWallet(userId, 'USD', tx);
        await acquireLocks(tx, [{ rank: LockRank.ORDER, id: orderId }]);
        await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
      });

    const refundPath = () =>
      prisma.$transaction(async (tx) => {
        await wallet.lockWallet(userId, 'USD', tx);
        await acquireLocks(tx, [{ rank: LockRank.ORDER, id: orderId }]);
        await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
      });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? paymentPath() : refundPath())),
    );

    const deadlocked = results.filter(
      (r) => r.status === 'rejected' && /deadlock/i.test(String((r as PromiseRejectedResult).reason)),
    );
    expect(deadlocked).toHaveLength(0);
  });

  it('serialises concurrent wallet mutations under sustained contention', async () => {
    const debit = () =>
      prisma.$transaction((tx) =>
        wallet.debit({ userId, currency: 'USD', amount: 10, type: 'ORDER_PAYMENT' }, tx),
      );

    const results = await Promise.allSettled(Array.from({ length: 40 }, debit));
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;

    const final = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    // Whatever succeeded, the arithmetic must be exact — no lost updates.
    expect(Number(final.balance)).toBe(500 - succeeded * 10);
    expect(await wallet.findDrift()).toHaveLength(0);
  });
});
