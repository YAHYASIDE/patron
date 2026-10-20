import { Prisma } from '@prisma/client';
import {
  BACKUP_TABLES, BACKUP_VERSION, BackupFile, BackupService, inspectBackup,
} from '../../src/modules/admin-tools/backup.service';

/** Every delegate the backup reads or writes, answering from a per-model row list. */
function fakePrisma(rows: Record<string, Array<Record<string, unknown>>> = {}, counts = { orders: 0, users: 0 }) {
  const created: Record<string, unknown[]> = {};
  const deleted: string[] = [];
  const updated: Array<{ model: string; args: unknown }> = [];
  const delegate = (model: string) => ({
    findMany: jest.fn(() => Promise.resolve(rows[model] ?? [])),
    count: jest.fn(() => Promise.resolve((rows[model] ?? []).length)),
    createMany: jest.fn(({ data }: { data: unknown[] }) => {
      created[model] = data;
      return Promise.resolve({ count: data.length });
    }),
    deleteMany: jest.fn(() => {
      deleted.push(model);
      return Promise.resolve({ count: 0 });
    }),
    updateMany: jest.fn((args: unknown) => {
      updated.push({ model, args });
      return Promise.resolve({ count: 1 });
    }),
  });
  const models = [...BACKUP_TABLES];
  const prisma: Record<string, unknown> = Object.fromEntries(models.map((m) => [m, delegate(m)]));
  (prisma.order as { count: jest.Mock }).count = jest.fn(() => Promise.resolve(counts.orders));
  (prisma.user as { count: jest.Mock }).count = jest.fn(() => Promise.resolve(counts.users));
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, created, deleted, updated };
}

describe('BackupService', () => {
  it('exports every table, without password hashes, 2FA secrets, sensitive inputs or secret settings', async () => {
    const { prisma } = fakePrisma({
      user: [{ id: 'u1', fullName: 'A', passwordHash: '$argon2id$x', twoFaSecretEnc: 'enc' }],
      order: [{ id: 'o1', quoteId: 'q1', adminNote: 'kept' }],
      orderInput: [
        { id: 'i1', fieldKey: 'player', value: '123', isSensitive: false },
        { id: 'i2', fieldKey: 'pin', value: 'enc:1234', isSensitive: true },
      ],
      productCode: [{ id: 'c1', codeEnc: 'iv.tag.ct' }],
      systemSetting: [{ key: 'platform.name', value: 'patron' }, { key: 'payments.stripe_secret', value: 'sk' }],
    });
    const file = await new BackupService(prisma as never).export();

    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.tables.user[0]).toEqual({ id: 'u1', fullName: 'A' });
    // the order keeps its note but not the quote it pointed at (quotes are not backed up)
    expect(file.tables.order[0]).toEqual({ id: 'o1', quoteId: null, adminNote: 'kept' });
    expect(file.tables.orderInput.map((i) => i.value)).toEqual(['123', '']);
    expect(file.tables.productCode[0].codeEnc).toBe('iv.tag.ct');
    expect(file.tables.systemSetting.map((s) => s.key)).toEqual(['platform.name']);
    expect(file.counts).toMatchObject({ user: 1, order: 1, systemSetting: 1 });
  });

  it('restores in dependency order into an empty database, replacing what migrations seeded', async () => {
    const { prisma, created, deleted } = fakePrisma();
    const file: BackupFile = {
      version: BACKUP_VERSION,
      exportedAt: '2026-10-20T00:00:00.000Z',
      counts: {},
      tables: {
        currency: [{ code: 'MRU' }],
        fxRate: [{ id: 'r1' }],
        user: [{ id: 'u1', email: 'owner@shop.test' }],
        order: [{ id: 'o1' }],
        payment: [{ id: 'p1', rawResponse: null }],
        systemSetting: [{ key: 'a', value: 1 }],
      },
    };

    const written = await new BackupService(prisma as never).restore(file, { ownerEmail: 'owner@shop.test', ownerPasswordHash: 'h' });

    expect(written).toMatchObject({ currency: 1, fxRate: 1, user: 1, order: 1, payment: 1, systemSetting: 1, product: 0, favorite: 0 });
    expect(deleted).toEqual(['systemSetting', 'fxRate', 'currency']);
    // a null JSON column is written as a database NULL
    expect((created.payment[0] as { rawResponse: unknown }).rawResponse).toBe(Prisma.DbNull);
    expect((prisma.user as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith({
      where: { email: 'owner@shop.test', passwordHash: null },
      data: { passwordHash: 'h' },
    });
  });

  it('refuses a database that has customers or orders, and a file that is not a backup', async () => {
    const busy = fakePrisma({}, { orders: 1, users: 0 });
    const file = { version: BACKUP_VERSION, exportedAt: '', counts: {}, tables: {} } as BackupFile;
    await expect(new BackupService(busy.prisma as never).restore(file)).rejects.toThrow('empty database');
    await expect(new BackupService(fakePrisma().prisma as never).restore({ version: 1 } as never)).rejects.toThrow('version 2 or 3');
  });

  it('carries passkeys as text and brings their bytes and counter back', async () => {
    const key = Buffer.from([1, 2, 3, 250]);
    const { prisma } = fakePrisma({ passkey: [{ id: 'k1', userId: 'u1', publicKey: new Uint8Array(key), counter: BigInt(7) }] });
    const file = JSON.parse(JSON.stringify(await new BackupService(prisma as never).export())) as BackupFile;
    expect(file.tables.passkey[0]).toEqual({ id: 'k1', userId: 'u1', publicKey: key.toString('base64'), counter: '7' });

    const target = fakePrisma();
    await new BackupService(target.prisma as never).restore(file);
    const row = target.created.passkey[0] as { publicKey: Buffer; counter: bigint };
    expect(Buffer.compare(row.publicKey, key)).toBe(0);
    expect(row.counter).toBe(BigInt(7));
  });

  it('leaves the Google Drive connection and the new private tables out', async () => {
    const { prisma } = fakePrisma({
      systemSetting: [{ key: 'backup.gdrive.folder_id', value: 'f' }, { key: 'backup.schedule', value: {} }],
    });
    const file = await new BackupService(prisma as never).export();
    expect(file.tables.systemSetting.map((s) => s.key)).toEqual(['backup.schedule']);
    for (const model of ['staffNotification', 'staffNotificationPref', 'webAuthnChallenge', 'backupRun']) {
      expect(BACKUP_TABLES).not.toContain(model);
    }
  });

  it('restores agents before the orders that name them and links referred customers afterwards', async () => {
    const order = BACKUP_TABLES;
    const before = (a: string, b: string) => expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    before('user', 'agent');
    before('agent', 'order');
    before('agent', 'agentPayout');
    before('agentPayout', 'commission');
    before('order', 'commission');
    before('usdtOrder', 'usdtOrderEvent');
    before('user', 'passkey');

    const { prisma, created, updated } = fakePrisma();
    const file: BackupFile = {
      version: BACKUP_VERSION,
      exportedAt: '2026-10-20T00:00:00.000Z',
      counts: {},
      tables: {
        user: [
          { id: 'u1', referredByAgentId: null },
          { id: 'u2', referredByAgentId: 'a1' },
          { id: 'u3', referredByAgentId: 'a1' },
        ],
        agent: [{ id: 'a1', userId: 'u1' }],
      },
    };
    await new BackupService(prisma as never).restore(file);
    expect((created.user as Array<{ referredByAgentId: unknown }>).every((u) => u.referredByAgentId === null)).toBe(true);
    expect(updated).toEqual([
      { model: 'user', args: { where: { id: { in: ['u2', 'u3'] } }, data: { referredByAgentId: 'a1' } } },
    ]);
  });

  it('still restores a version-2 file (no V2 tables)', async () => {
    const { prisma } = fakePrisma();
    const written = await new BackupService(prisma as never).restore({
      version: 2, exportedAt: '2026-10-19T00:00:00.000Z', counts: { user: 1 }, tables: { user: [{ id: 'u1' }] },
    });
    expect(written).toMatchObject({ user: 1, agent: 0, commission: 0, usdtOrder: 0 });
  });
});

describe('inspectBackup', () => {
  const good = (): BackupFile => ({
    version: BACKUP_VERSION,
    exportedAt: '2026-10-20T00:00:00.000Z',
    counts: { currency: 1, user: 2 },
    tables: { currency: [{ code: 'USD' }], user: [{ id: 'a' }, { id: 'b' }] },
  });

  it('counts the rows per table of a sound file', () => {
    const check = inspectBackup(good());
    expect(check).toMatchObject({ ok: true, version: BACKUP_VERSION, exportedAt: '2026-10-20T00:00:00.000Z', totalRows: 3, problems: [] });
    expect(check.counts).toMatchObject({ currency: 1, user: 2, order: 0 });
  });

  it('names what is wrong', () => {
    const f = good() as unknown as Record<string, unknown> & BackupFile;
    f.counts.user = 5;
    (f.tables as Record<string, unknown>).order = 'x';
    f.tables.mystery = [];
    const check = inspectBackup(f);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      'Table user announces 5 rows but holds 2',
      'Table order is not a list of rows',
      'Unknown table mystery',
    ]);
    expect(inspectBackup({ version: 9, tables: {} }).problems).toEqual([
      'Not a patron backup this version can restore (found version 9, expected 2 or 3)',
      'The file holds no currencies: a real shop always has some',
    ]);
    expect(inspectBackup(null)).toMatchObject({ ok: false, version: null, exportedAt: null });
    expect(inspectBackup(null).problems).toContain('The file has no tables');
  });
});
