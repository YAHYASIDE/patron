import { PrismaService } from '../../src/common/prisma/prisma.service';
import { BackupService, BackupFile } from '../../src/modules/admin-tools/backup.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';

/**
 * The backup is only worth something if the shop comes back from it. This
 * builds a small shop (a customer with a wallet history, an order paid and
 * partly refunded, a delivered code and unsold stock), downloads the backup as
 * the owner would, wipes the database, restores into it and checks that every
 * amount, row count and code comes back — and that no secret travelled.
 */
describe('Backup and restore', () => {
  let prisma: PrismaService;
  let backups: BackupService;
  let wallet: WalletService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    backups = new BackupService(prisma);
    wallet = new WalletService(prisma);
  });

  afterAll(() => prisma.$disconnect());

  async function buildShop() {
    for (const c of [
      { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
      { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', decimals: 0 },
    ]) await prisma.currency.upsert({ where: { code: c.code }, update: {}, create: c });
    const rate = await prisma.fxRate.create({ data: { baseCurrency: 'USD', quoteCurrency: 'MRU', rate: 39.8, source: 'MANUAL' } });
    const role = await prisma.role.create({ data: { name: 'customer', isSystem: true } });
    const owner = await prisma.user.create({
      data: { email: 'owner@shop.test', fullName: 'Owner', passwordHash: '$argon2id$secret-hash', twoFaSecretEnc: 'enc-2fa' },
    });
    const customer = await prisma.user.create({
      data: { phone: '+22240000001', fullName: 'Aicha', phoneVerifiedAt: new Date(), country: 'MR', roles: { create: { roleId: role.id } } },
    });
    await prisma.$transaction((tx) => wallet.credit({ userId: customer.id, currency: 'MRU', amount: 500, type: 'ADMIN_ADJUSTMENT' }, tx));
    await prisma.$transaction((tx) => wallet.debit({ userId: customer.id, currency: 'MRU', amount: 40, type: 'ORDER_PAYMENT' }, tx));

    const category = await prisma.category.create({ data: { slug: 'games', nameAr: 'ألعاب', nameEn: 'Games' } });
    const sub = await prisma.category.create({ data: { slug: 'mobile', nameAr: 'هاتف', nameEn: 'Mobile', parentId: category.id } });
    const game = await prisma.game.create({ data: { slug: 'pubg', nameAr: 'ببجي', nameEn: 'PUBG', categoryId: sub.id, inputSchema: [{ key: 'player_id' }] } });
    const product = await prisma.product.create({
      data: {
        sku: 'TOP-PUBG-60', type: 'GAME_TOPUP', delivery: 'MANUAL', nameAr: 'ببجي 60', nameEn: 'PUBG 60',
        costPrice: 0.9, sellPrice: 1, currency: 'USD', categoryId: sub.id, gameId: game.id, metadata: { guide: { ar: 'خطوات' } },
        prices: { create: [{ currencyCode: 'MRU', sellPrice: 40 }] },
      },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: 'PTN-RESTORE-1', userId: customer.id, status: 'COMPLETED', subtotal: 40, total: 40, currency: 'MRU',
        baseCurrency: 'USD', fxRate: 39.8, totalBase: 1.01, fxRateId: rate.id, adminNote: 'paid fast', paidAt: new Date(), completedAt: new Date(),
        items: {
          create: [{
            productId: product.id, productNameAr: 'ببجي 60', productNameEn: 'PUBG 60', unitPrice: 40, unitCost: 0.9, lineTotal: 40, status: 'DELIVERED', deliveredAt: new Date(),
            inputs: { create: [
              { fieldKey: 'player_id', fieldLabel: 'Player ID', value: '5123456789', isSensitive: false },
              { fieldKey: 'pin', fieldLabel: 'PIN', value: 'enc:1234', isSensitive: true },
            ] },
            results: { create: [{ resultType: 'code', valueEnc: 'iv.tag.ciphertext-delivered' }] },
          }],
        },
      },
      include: { items: true },
    });
    await prisma.productCode.createMany({
      data: [
        { productId: product.id, codeEnc: 'iv.tag.ciphertext-sold', codeHash: 'h-sold', isUsed: true, orderItemId: order.items[0].id },
        { productId: product.id, codeEnc: 'iv.tag.ciphertext-unsold', codeHash: 'h-unsold' },
      ],
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id, userId: customer.id, gateway: 'WALLET', amount: 40, currency: 'MRU', baseCurrency: 'USD', fxRate: 39.8,
        amountBase: 1.01, status: 'PARTIALLY_REFUNDED', refundedAmount: 10, gatewayRef: 'wallet_x', rawResponse: { ok: true },
      },
    });
    await prisma.refund.create({
      data: {
        orderId: order.id, paymentId: payment.id, amount: 10, currency: 'MRU', fxRate: 39.8, amountBase: 0.25, reason: 'late',
        status: 'PROCESSED', toWallet: true, requestedById: owner.id, processedById: owner.id, processedAt: new Date(),
      },
    });
    await prisma.$transaction((tx) => wallet.credit({ userId: customer.id, currency: 'MRU', amount: 10, type: 'REFUND' }, tx));
    await prisma.coupon.create({ data: { code: 'EID10', discountType: 'PERCENT', discountValue: 10 } });
    await prisma.banner.create({ data: { titleAr: 'عرض', linkType: 'offers' } });
    await prisma.systemSetting.createMany({
      data: [
        { key: 'payments.manual_note', value: 'نؤكّد بسرعة' },
        { key: 'mail.api_key', value: 'k-should-stay' },
      ],
    });
    return { owner, customer };
  }

  it('brings back every amount, row and code, and carries no secret', async () => {
    await buildShop();
    const before = await backups.fingerprint();

    // what the owner downloads: a JSON file
    const file = JSON.parse(JSON.stringify(await backups.export())) as BackupFile;
    const text = JSON.stringify(file);
    for (const secret of ['$argon2id$secret-hash', 'enc-2fa', 'k-should-stay', 'enc:1234']) expect(text).not.toContain(secret);
    expect(text).toContain('iv.tag.ciphertext-unsold'); // stock travels, encrypted as stored
    expect(file.tables.order[0].adminNote).toBe('paid fast');

    // the database is lost…
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    // …a new one is migrated (which seeds a currency, a rate and a setting of its own)
    await prisma.currency.create({ data: { code: 'XOF', nameAr: 'فرنك', nameEn: 'CFA', symbol: 'F', decimals: 0 } });
    await prisma.systemSetting.create({ data: { key: 'payments.manual_note', value: 'default' } });

    const written = await backups.restore(file, { ownerEmail: 'owner@shop.test', ownerPasswordHash: '$argon2id$new-hash' });
    expect(written.order).toBe(1);

    const after = await backups.fingerprint();
    expect(after.walletBalances).toBe(before.walletBalances);
    expect(after.ledgerSum).toBe(before.ledgerSum);
    expect(after.walletBalances).toBe('470');
    expect(after.paid).toBe(before.paid);
    expect(after.refunded).toBe(before.refunded);
    expect(after.codes).toEqual({ used: 1, unsold: 1 });
    // the secret setting stayed behind; every other row came back
    expect(after.counts).toEqual({ ...before.counts, systemSetting: before.counts.systemSetting - 1 });
    expect(await wallet.findDriftFull()).toHaveLength(0);

    // the backup's own setting wins over the new database's default
    const note = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'payments.manual_note' } });
    expect(note.value).toBe('نؤكّد بسرعة');
    // the owner can sign in again; nobody else got a password
    const users = await prisma.user.findMany({ select: { email: true, passwordHash: true, twoFaSecretEnc: true } });
    expect(users.find((u) => u.email === 'owner@shop.test')?.passwordHash).toBe('$argon2id$new-hash');
    expect(users.filter((u) => u.email !== 'owner@shop.test').every((u) => u.passwordHash === null)).toBe(true);
    expect(users.every((u) => u.twoFaSecretEnc === null)).toBe(true);
    // the delivered code is still there for the customer, as ciphertext
    const result = await prisma.orderResult.findFirstOrThrow();
    expect(result.valueEnc).toBe('iv.tag.ciphertext-delivered');
  });

  it('refuses to restore over a shop that has customers or orders', async () => {
    await buildShop();
    const file = JSON.parse(JSON.stringify(await backups.export())) as BackupFile;
    await expect(backups.restore(file)).rejects.toThrow('empty database');
  });

  it('refuses a file that is not a backup', async () => {
    await expect(backups.restore({ version: 1 } as unknown as BackupFile)).rejects.toThrow('version 2');
  });
});
