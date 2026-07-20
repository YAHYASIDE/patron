import { PrismaClient } from '@prisma/client';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';

/**
 * The test that matters most for the wallet: concurrent debits must not
 * over-spend. Without FOR UPDATE this passes single-threaded and loses money
 * in production.
 */
describe('WalletService concurrency', () => {
  let prisma: PrismaService;
  let wallet: WalletService;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    wallet = new WalletService(prisma);
    await prisma.$connect();
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `wallet-${Date.now()}@test.local`,
        fullName: 'Wallet Test',
        passwordHash: 'x',
        wallets: { create: { currencyCode: 'USD', balance: 100 } },
      },
    });
    userId = user.id;
  });

  it('rejects the second of two concurrent debits that would overdraw', async () => {
    const debit = () =>
      prisma.$transaction((tx) =>
        wallet.debit(
          { userId, currency: 'USD', amount: 80, type: 'ORDER_PAYMENT' },
          tx,
        ),
      );

    const results = await Promise.allSettled([debit(), debit()]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');

    expect(fulfilled).toHaveLength(1);

    const balance = await prisma.wallet.findFirstOrThrow({ where: { userId } });
    expect(Number(balance.balance)).toBe(20);
  });

  it('keeps the ledger and the cached balance in agreement', async () => {
    await prisma.$transaction((tx) =>
      wallet.debit({ userId, currency: 'USD', amount: 30, type: 'ORDER_PAYMENT' }, tx),
    );
    await prisma.$transaction((tx) =>
      wallet.credit({ userId, currency: 'USD', amount: 10, type: 'REFUND' }, tx),
    );

    const drift = await wallet.findDrift();
    expect(drift).toHaveLength(0);
  });
});
