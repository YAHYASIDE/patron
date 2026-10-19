import { Prisma } from '@prisma/client';
import { BackupService, BACKUP_VERSION, BackupFile } from '../../src/modules/admin-tools/backup.service';

/** Every delegate the backup reads or writes, answering from a per-model row list. */
function fakePrisma(rows: Record<string, Array<Record<string, unknown>>> = {}, counts = { orders: 0, users: 0 }) {
  const created: Record<string, unknown[]> = {};
  const deleted: string[] = [];
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
    updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
  });
  const models = [
    'currency', 'fxRate', 'role', 'permission', 'rolePermission', 'category', 'game', 'product', 'productPrice', 'user',
    'userRole', 'wallet', 'walletTransaction', 'coupon', 'order', 'orderItem', 'orderInput', 'orderResult', 'productCode',
    'payment', 'refund', 'review', 'supportTicket', 'banner', 'systemSetting',
  ];
  const prisma: Record<string, unknown> = Object.fromEntries(models.map((m) => [m, delegate(m)]));
  (prisma.order as { count: jest.Mock }).count = jest.fn(() => Promise.resolve(counts.orders));
  (prisma.user as { count: jest.Mock }).count = jest.fn(() => Promise.resolve(counts.users));
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, created, deleted };
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

    expect(written).toMatchObject({ currency: 1, fxRate: 1, user: 1, order: 1, payment: 1, systemSetting: 1, product: 0 });
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
    await expect(new BackupService(fakePrisma().prisma as never).restore({ version: 1 } as never)).rejects.toThrow('version 2');
  });
});
