import { PrismaService } from '../../src/common/prisma/prisma.service';
import { BackupService, BackupFile } from '../../src/modules/admin-tools/backup.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { randomBytes, randomUUID } from 'crypto';
import { BackupRunsService } from '../../src/modules/admin-tools/backup-runs.service';
import { readBackupFile } from '../../src/modules/admin-tools/backup-crypto';
import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { AuditService } from '../../src/common/audit/audit.service';

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
    const ordersRead = await prisma.permission.create({ data: { key: 'orders.read', module: 'orders' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: ordersRead.id } });
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
    await prisma.favorite.create({ data: { userId: customer.id, brandKey: 'g-pubg' } });
    await prisma.savedInput.create({ data: { userId: customer.id, gameId: game.id, label: 'حسابي', values: { player_id: '5123456789' } } });
    await prisma.priceWatch.create({ data: { userId: customer.id, productId: product.id, priceAtWatch: 1 } });
    await prisma.coupon.create({ data: { code: 'EID10', discountType: 'PERCENT', discountValue: 10 } });
    await prisma.banner.create({ data: { titleAr: 'عرض', linkType: 'offers' } });
    await prisma.systemSetting.createMany({
      data: [
        { key: 'payments.manual_note', value: 'نؤكّد بسرعة' },
        { key: 'mail.api_key', value: 'k-should-stay' },
        { key: 'backup.gdrive.folder_id', value: 'drive-folder-of-this-deployment' },
      ],
    });

    // Platform V2: an agent who brought the customer, the order credited to them, a paid commission
    const agentUser = await prisma.user.create({ data: { phone: '+22240000002', fullName: 'Mandoub', country: 'MR' } });
    const agent = await prisma.agent.create({ data: { userId: agentUser.id, code: 'AGENT7', commissionValue: 5 } });
    await prisma.user.update({ where: { id: customer.id }, data: { referredByAgentId: agent.id } });
    await prisma.order.update({ where: { id: order.id }, data: { agentId: agent.id } });
    const payout = await prisma.agentPayout.create({ data: { agentId: agent.id, amount: 0.05, currency: 'USD', reference: 'cash-1', paidById: owner.id } });
    await prisma.commission.create({
      data: {
        agentId: agent.id, orderId: order.id, basis: 1.01, amount: 0.05, currency: 'USD', rule: { type: 'PERCENT', value: 5 },
        status: 'PAID', payoutId: payout.id, earnedAt: new Date(), paidAt: new Date(),
      },
    });
    await prisma.passkey.create({
      data: { userId: customer.id, credentialId: 'cred-1', publicKey: Buffer.from([0xa5, 0x01, 0x02, 0xff]), counter: BigInt(3), transports: ['internal'] },
    });
    await prisma.webAuthnChallenge.create({ data: { purpose: 'login', challenge: 'challenge-left-out', expiresAt: new Date() } });
    await prisma.accountRecoveryRequest.create({
      data: { userId: customer.id, contact: '+22240000001', fullName: 'Aicha', proof: 'PTN-RESTORE-1', status: 'VERIFIED', reviewedById: owner.id },
    });
    const usdt = await prisma.usdtOrder.create({
      data: {
        number: 'USDT-20261020-000001', userId: customer.id, status: 'COMPLETED', amountUsdt: 10, delivery: 'ONCHAIN', network: 'TRC20',
        address: 'TXYZaddress', rate: 41, currency: 'MRU', subtotal: 410, fee: 10, total: 420, txid: 'tx-1', reviewedById: owner.id,
        proofUploadId: '00000000-0000-4000-8000-000000000001',
      },
    });
    await prisma.usdtOrderEvent.createMany({
      data: [
        { usdtOrderId: usdt.id, action: 'created', toStatus: 'NEW' },
        { usdtOrderId: usdt.id, actorId: owner.id, action: 'sent', fromStatus: 'READY_TO_SEND', toStatus: 'COMPLETED', data: { txid: 'tx-1' } },
      ],
    });
    await prisma.bankNotification.create({
      data: { deviceId: 'phone-1', sourceApp: 'bankily', text: 'Vous avez reçu 420 MRU', postedAt: new Date(), amount: 420, currency: 'MRU', parser: 'bankily', fingerprint: 'fp-1' },
    });
    await prisma.staffNotification.create({ data: { type: 'order.paid', title: 'طلب', body: 'جديد', dedupeKey: 'left-out' } });
    await prisma.backupRun.create({ data: { trigger: 'download', destination: 'download', status: 'SUCCEEDED' } });
    return { owner, customer, agent };
  }

  it('brings back every amount, row and code, and carries no secret', async () => {
    const { customer, agent } = await buildShop();
    const before = await backups.fingerprint();

    // what the owner downloads: a JSON file
    const file = JSON.parse(JSON.stringify(await backups.export())) as BackupFile;
    const text = JSON.stringify(file);
    for (const secret of [
      '$argon2id$secret-hash', 'enc-2fa', 'k-should-stay', 'enc:1234', 'drive-folder-of-this-deployment', 'challenge-left-out',
    ]) expect(text).not.toContain(secret);
    expect(Object.keys(file.tables)).not.toEqual(expect.arrayContaining(['staffNotification']));
    expect(file.tables.backupRun).toBeUndefined();
    expect(file.tables.usdtOrder[0].proofUploadId).toBeNull(); // uploads are not in the backup
    expect(text).toContain('iv.tag.ciphertext-unsold'); // stock travels, encrypted as stored
    expect(file.tables.order[0].adminNote).toBe('paid fast');

    // the database is lost…
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    // …a new one is migrated (which seeds a currency, a rate and a setting of its own)
    await prisma.currency.create({ data: { code: 'XOF', nameAr: 'فرنك', nameEn: 'CFA', symbol: 'F', decimals: 0 } });
    await prisma.systemSetting.create({ data: { key: 'payments.manual_note', value: 'default' } });
    // …and its own roles and permissions: the same customer role and orders.read (other ids), plus
    // what newer migrations add and this backup predates: the agent role and backup.manage
    await prisma.role.create({
      data: {
        name: 'customer',
        permissions: { create: [
          { permission: { create: { key: 'orders.read', module: 'orders' } } },
          { permission: { create: { key: 'backup.manage', module: 'system' } } },
        ] },
      },
    });
    await prisma.role.create({ data: { name: 'agent', isSystem: true } });

    const written = await backups.restore(file, { ownerEmail: 'owner@shop.test', ownerPasswordHash: '$argon2id$new-hash' });
    expect(written.order).toBe(1);

    const after = await backups.fingerprint();
    expect(after.walletBalances).toBe(before.walletBalances);
    expect(after.ledgerSum).toBe(before.ledgerSum);
    expect(after.walletBalances).toBe('470');
    expect(after.paid).toBe(before.paid);
    expect(after.refunded).toBe(before.refunded);
    expect(after.codes).toEqual({ used: 1, unsold: 1 });
    expect(after.counts).toMatchObject({ favorite: 1, savedInput: 1, priceWatch: 1 });
    expect(after.counts).toMatchObject({
      passkey: 1, accountRecoveryRequest: 1, usdtOrder: 1, usdtOrderEvent: 2, agent: 1, agentPayout: 1, commission: 1, bankNotification: 1,
    });
    // the secret settings stayed behind; every other row came back, plus the newer role and permission
    expect(after.counts).toEqual({
      ...before.counts,
      systemSetting: before.counts.systemSetting - 2,
      role: before.counts.role + 1,
      permission: before.counts.permission + 1,
      rolePermission: before.counts.rolePermission + 1,
    });
    const access = await prisma.role.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, permissions: { select: { permission: { select: { key: true } } }, orderBy: { permission: { key: 'asc' } } } },
    });
    expect(access.map((r) => [r.name, r.permissions.map((p) => p.permission.key)])).toEqual([
      ['agent', []],
      ['customer', ['backup.manage', 'orders.read']],
    ]);
    // the customer role kept the backup's id: user roles still point at it
    expect((await prisma.userRole.findFirstOrThrow()).roleId).toBe(access[1].id);
    // the agent links survived the users ↔ agents circle
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).referredByAgentId).toBe(agent.id);
    expect((await prisma.order.findFirstOrThrow()).agentId).toBe(agent.id);
    expect((await prisma.commission.findFirstOrThrow()).status).toBe('PAID');
    const passkey = await prisma.passkey.findFirstOrThrow();
    expect(Buffer.from(passkey.publicKey).toString('hex')).toBe('a50102ff');
    expect(passkey.counter).toBe(BigInt(3));
    expect(await prisma.staffNotification.count()).toBe(0);
    expect(await prisma.webAuthnChallenge.count()).toBe(0);
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

  async function wipe() {
    const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }

  it('restores from encrypted files (passphrase and server key), logs each copy and raises/clears the alert', async () => {
    await buildShop();
    const key = randomBytes(32).toString('hex');
    const drive = {
      assertConfigured: jest.fn(),
      upload: jest.fn<Promise<{ id: string; name: string }>, [string, Buffer, string]>(() => Promise.resolve({ id: 'drive-1', name: 'n' })),
      prune: jest.fn(() => Promise.resolve([])),
    };
    const config = { get: (k: string) => (k === 'BACKUP_ENCRYPTION_KEY' ? key : undefined) };
    const notices = new StaffNotificationsService(prisma);
    const runs = new BackupRunsService(prisma, backups, drive as never, notices, new AuditService(prisma), config as never);
    await prisma.backupRun.deleteMany(); // the log row buildShop left as sample data
    const before = await backups.fingerprint();

    // a failed scheduled copy: logged, one urgent notice
    drive.upload.mockRejectedValueOnce(new Error('Google Drive: uploading failed (quota)'));
    await expect(runs.toDrive('scheduled_daily')).rejects.toThrow('quota');
    const passphrase = `test-${randomUUID()}`;
    const download = await runs.encryptedDownload(passphrase);
    await runs.toDrive('scheduled_daily');
    const scheduled = drive.upload.mock.calls[1][1];

    const log = await prisma.backupRun.findMany({ orderBy: { startedAt: 'asc' } });
    expect(log.map((r) => [r.trigger, r.destination, r.status, r.encrypted])).toEqual([
      ['scheduled_daily', 'google_drive', 'FAILED', true],
      ['download', 'download', 'SUCCEEDED', true],
      ['scheduled_daily', 'google_drive', 'SUCCEEDED', true],
    ]);
    expect(log[0].error).toContain('quota');
    expect(log[2]).toMatchObject({ remoteId: 'drive-1', sizeBytes: scheduled.length });
    const notice = await prisma.staffNotification.findUniqueOrThrow({ where: { dedupeKey: 'backup.failed' } });
    expect(notice).toMatchObject({ type: 'backup.failed', priority: 'URGENT' });
    expect(notice.resolvedAt).not.toBeNull(); // the next good copy closed it

    // the dry run reads both files and writes nothing
    const runsBefore = await prisma.backupRun.count();
    await expect(runs.verify(download.body, passphrase)).resolves.toMatchObject({ ok: true, encrypted: true });
    await expect(runs.verify(scheduled)).resolves.toMatchObject({ ok: true, encrypted: true });
    expect(await prisma.backupRun.count()).toBe(runsBefore);

    for (const [bytes, secrets] of [[download.body, { passphrase }], [scheduled, { keyHex: key }]] as const) {
      await wipe();
      const { data } = await readBackupFile(bytes, secrets);
      await backups.restore(data as BackupFile);
      const after = await backups.fingerprint();
      expect(after.ledgerSum).toBe(before.ledgerSum);
      // every row the file holds came back (the later copy also holds the download time)
      expect(after.counts).toEqual((data as BackupFile).counts);
      expect(after.counts).toMatchObject({ order: 1, agent: 1, commission: 1, usdtOrderEvent: 2 });
    }
  });

  it('refuses a file that is not a backup', async () => {
    await expect(backups.restore({ version: 1 } as unknown as BackupFile)).rejects.toThrow('version 2 or 3');
  });
});
