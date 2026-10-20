import { PrismaService } from '../../src/common/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { ReferenceService } from '../../src/common/reference/reference.service';

/**
 * Sustained-concurrency tests.
 *
 * Unlike the targeted concurrency specs, these run for long enough and at
 * enough parallelism to surface problems that only appear under contention:
 * connection-pool exhaustion, lock convoys, and invariants that hold for two
 * concurrent operations but not for two hundred.
 *
 * Marked slow — excluded from the default run, executed in CI nightly.
 */
describe('Sustained concurrency (stress)', () => {
  jest.setTimeout(180_000);

  let prisma: PrismaService;
  let wallet: WalletService;
  let orders: OrdersService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    wallet = new WalletService(prisma);
    const crypto = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);
    // Real collaborators, not mocks: ReferenceService allocates order numbers
    // from a Postgres sequence, and a mock would hide a uniqueness bug that
    // only appears under the concurrency these tests exist to exercise.
    orders = new OrdersService(
      prisma,
      crypto,
      new OutboxService(prisma),
      new AuditService(prisma),
      new ReferenceService(prisma),
    );

    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'د', nameEn: 'USD', symbol: '$', isBase: true },
    });
  });

  afterAll(() => prisma.$disconnect());

  it('keeps the wallet ledger exact across 500 interleaved debits and credits', async () => {
    const user = await prisma.user.create({
      data: {
        email: `stress-${Date.now()}@test.local`, fullName: 'Stress', passwordHash: 'x',
        wallets: { create: { currencyCode: 'USD', balance: 10_000 } },
      },
    });

    const operations = Array.from({ length: 500 }, (_, i) =>
      prisma.$transaction((tx) =>
        i % 3 === 0
          ? wallet.credit({ userId: user.id, currency: 'USD', amount: 5, type: 'REFUND' }, tx)
          : wallet.debit({ userId: user.id, currency: 'USD', amount: 3, type: 'ORDER_PAYMENT' }, tx),
      ),
    );

    const results = await Promise.allSettled(operations);
    const failed = results.filter((r) => r.status === 'rejected');

    // Under contention some transactions may be aborted by the database. That
    // is acceptable; silently wrong arithmetic is not.
    const drift = await wallet.findDrift();
    expect(drift).toHaveLength(0);

    const ledger = await prisma.walletTransaction.aggregate({
      where: { userId: user.id }, _sum: { amount: true },
    });
    const current = await prisma.wallet.findFirstOrThrow({ where: { userId: user.id } });
    expect(Number(current.balance)).toBe(10_000 + Number(ledger._sum.amount ?? 0));

    // Sanity: the test is meaningless if everything failed.
    expect(failed.length).toBeLessThan(results.length / 2);
  });

  it('creates exactly one order per quote across 50 concurrent quote submissions', async () => {
    const category = await prisma.category.create({
      data: { slug: `stress-${Date.now()}`, nameAr: 'ف', nameEn: 'C' },
    });
    const product = await prisma.product.create({
      data: {
        sku: `STR-${Date.now()}`, type: 'GIFT_CARD', delivery: 'CODE_POOL',
        nameAr: 'م', nameEn: 'P', costPrice: 8, sellPrice: 10, currency: 'USD', categoryId: category.id,
      },
    });

    const quotes = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        const user = await prisma.user.create({
          data: { email: `sq-${Date.now()}-${i}@test.local`, fullName: 'Q', passwordHash: 'x' },
        });
        const quote = await prisma.checkoutQuote.create({
          data: {
            quoteNumber: `QT-${Date.now()}-${i}`, userId: user.id,
            subtotal: 10, total: 10, currency: 'USD', baseCurrency: 'USD',
            fxRate: 1, totalBase: 10, totalCostBase: 8,
            expiresAt: new Date(Date.now() + 900_000),
            items: {
              create: {
                productId: product.id, productNameAr: 'م', productNameEn: 'P',
                quantity: 1, unitPrice: 10, unitPriceBase: 10, unitCostBase: 8, lineTotal: 10,
              },
            },
          },
        });
        return { userId: user.id, quoteId: quote.id };
      }),
    );

    // Every quote submitted three times, all at once.
    await Promise.allSettled(
      quotes.flatMap(({ userId, quoteId }) =>
        Array.from({ length: 3 }, () => orders.createFromQuote(userId, quoteId, {})),
      ),
    );

    for (const { quoteId } of quotes) {
      expect(await prisma.order.count({ where: { quoteId } })).toBe(1);
    }
  });

  it('emits exactly one outbox event per created order under load', async () => {
    const events = await prisma.outboxEvent.groupBy({
      by: ['aggregateId'],
      where: { eventType: 'order.created' },
      _count: { _all: true },
    });
    for (const event of events) expect(event._count._all).toBe(1);
  });
});
