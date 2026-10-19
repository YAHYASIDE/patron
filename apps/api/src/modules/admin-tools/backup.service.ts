import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * A full backup the shop can be rebuilt from, and the restore that does it.
 *
 * Render's free database is deleted after about 30 days, so the backup has to
 * hold everything money depends on: customers and their wallets with the whole
 * ledger, orders with payments and refunds, the catalogue, and the codes the
 * owner paid for — unsold stock and delivered ones. Codes travel as the
 * ciphertext already stored (AES-256-GCM): the file never holds a readable
 * code, and only the same ENCRYPTION_KEY can open them after a restore.
 *
 * Left out on purpose: password hashes, 2FA secrets, sessions, verification
 * codes, receipt images and other uploads, provider API keys, notifications,
 * audit and event logs, and settings whose name says they are secret. After a
 * restore staff set a new password (the restore sets the seeded owner's one)
 * and customers sign in with their WhatsApp number as before.
 */
export const BACKUP_VERSION = 2;

/** Settings whose names say they hold a secret never leave the database. */
const SECRET_SETTING = /secret|password|token|api[_-]?key|private/i;

type Row = Record<string, unknown>;

/** One table: how to read it for the backup, and the columns it must not carry. */
interface TableSpec {
  /** Prisma model delegate name. */
  model: string;
  omit?: string[];
  /** Columns cleared on export: they point at tables the backup does not hold. */
  clear?: string[];
  where?: Row;
  orderBy?: Row | Row[];
  /** Rows to change before they leave (e.g. drop a sensitive value). */
  map?: (row: Row) => Row;
}

/** In restore order: every table after the ones it points to. */
const TABLES: TableSpec[] = [
  { model: 'currency', orderBy: { code: 'asc' } },
  { model: 'fxRate', orderBy: { effectiveAt: 'asc' } },
  { model: 'role', orderBy: { name: 'asc' } },
  { model: 'permission', orderBy: { key: 'asc' } },
  { model: 'rolePermission' },
  // parents before their sub-categories
  { model: 'category', orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { sortOrder: 'asc' }] },
  { model: 'game', orderBy: { sortOrder: 'asc' } },
  { model: 'product', orderBy: { createdAt: 'asc' } },
  { model: 'productPrice' },
  { model: 'user', omit: ['passwordHash', 'twoFaSecretEnc'], orderBy: { createdAt: 'asc' } },
  { model: 'userRole' },
  { model: 'wallet' },
  { model: 'walletTransaction', orderBy: { createdAt: 'asc' } },
  { model: 'coupon', orderBy: { createdAt: 'asc' } },
  { model: 'order', clear: ['quoteId'], orderBy: { createdAt: 'asc' } },
  { model: 'orderItem', orderBy: { createdAt: 'asc' } },
  {
    model: 'orderInput',
    // a password or PIN the customer typed stays out; the backup keeps only that one was given
    map: (row) => (row.isSensitive ? { ...row, value: '' } : row),
  },
  { model: 'orderResult' },
  { model: 'productCode', orderBy: { createdAt: 'asc' } },
  { model: 'payment', orderBy: { createdAt: 'asc' } },
  { model: 'refund', orderBy: { createdAt: 'asc' } },
  { model: 'review', orderBy: { createdAt: 'asc' } },
  { model: 'supportTicket', orderBy: { createdAt: 'asc' } },
  { model: 'banner', orderBy: { sortOrder: 'asc' } },
  { model: 'systemSetting', orderBy: { key: 'asc' } },
];

/** Tables a fresh, migrated database already has rows in; the backup's rows replace them. */
const REPLACED_ON_RESTORE = ['systemSetting', 'fxRate', 'currency'];

/** Json columns per model: a null there must be written as DbNull, not as a JSON null. */
const JSON_FIELDS: Record<string, string[]> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name.charAt(0).toLowerCase() + m.name.slice(1),
    m.fields.filter((f) => f.type === 'Json').map((f) => f.name),
  ]),
);

function restorable(model: string, row: Row): Row {
  const out: Row = { ...row };
  for (const f of JSON_FIELDS[model] ?? []) if (out[f] === null) out[f] = Prisma.DbNull;
  return out;
}

export interface BackupFile {
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, Row[]>;
}

@Injectable()
export class BackupService {
  constructor(private prisma: PrismaService) {}

  private delegate(model: string) {
    return (this.prisma as unknown as Record<string, {
      findMany(args: Row): Promise<Row[]>;
      createMany(args: Row): Promise<{ count: number }>;
      deleteMany(args?: Row): Promise<{ count: number }>;
      count(args?: Row): Promise<number>;
    }>)[model];
  }

  async export(): Promise<BackupFile> {
    const tables: Record<string, Row[]> = {};
    for (const spec of TABLES) {
      const rows = await this.delegate(spec.model).findMany({
        ...(spec.where && { where: spec.where }),
        ...(spec.orderBy && { orderBy: spec.orderBy }),
      });
      tables[spec.model] = rows
        .filter((r) => spec.model !== 'systemSetting' || !SECRET_SETTING.test(String(r.key)))
        .map((r) => {
          const out: Row = { ...r };
          for (const k of spec.omit ?? []) delete out[k];
          for (const k of spec.clear ?? []) out[k] = null;
          return spec.map ? spec.map(out) : out;
        });
    }
    return {
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
      tables,
    };
  }

  /**
   * Load a backup into a freshly migrated, empty database (no customers, no
   * orders). Refuses anything else: restoring over live data would mix two
   * shops. Runs in one transaction, so a bad file leaves the database as it was.
   * Returns the rows written per table.
   */
  async restore(file: BackupFile, opts: { ownerEmail?: string; ownerPasswordHash?: string } = {}) {
    if (!file || file.version !== BACKUP_VERSION || typeof file.tables !== 'object') {
      throw new BadRequestException(`Not a version ${BACKUP_VERSION} patron backup`);
    }
    const [orders, customers] = await Promise.all([
      this.prisma.order.count(),
      this.prisma.user.count(),
    ]);
    if (orders > 0 || customers > 0) {
      throw new BadRequestException('Restore only into an empty database: this one already has customers or orders');
    }

    const written: Record<string, number> = {};
    await this.prisma.$transaction(
      async (tx) => {
        const db = tx as unknown as Record<string, { createMany(a: Row): Promise<{ count: number }>; deleteMany(a?: Row): Promise<unknown> }>;
        // rows a migration seeded are replaced (rates first: they point at currencies), then everything is inserted in order
        for (const model of REPLACED_ON_RESTORE) {
          if (file.tables[model]?.length) await db[model].deleteMany({});
        }
        for (const spec of TABLES) {
          const rows = file.tables[spec.model] ?? [];
          if (!rows.length) {
            written[spec.model] = 0;
            continue;
          }
          const { count } = await db[spec.model].createMany({ data: rows.map((r) => restorable(spec.model, r)) });
          written[spec.model] = count;
        }
        // the owner signs in again with the seeded password; everyone else resets theirs
        if (opts.ownerEmail && opts.ownerPasswordHash) {
          await tx.user.updateMany({
            where: { email: opts.ownerEmail, passwordHash: null },
            data: { passwordHash: opts.ownerPasswordHash },
          });
        }
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
    return written;
  }

  /** Numbers that must survive a backup and restore unchanged. */
  async fingerprint() {
    const [wallets, ledger, paid, refunded, codes] = await Promise.all([
      this.prisma.wallet.aggregate({ _sum: { balance: true } }),
      this.prisma.walletTransaction.aggregate({ _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, _sum: { amount: true } }),
      this.prisma.refund.aggregate({ where: { status: 'PROCESSED' }, _sum: { amount: true } }),
      this.prisma.productCode.groupBy({ by: ['isUsed'], _count: { _all: true } }),
    ]);
    const counts: Record<string, number> = {};
    for (const spec of TABLES) counts[spec.model] = await this.delegate(spec.model).count();
    const dec = (v: Prisma.Decimal | null | undefined) => (v ?? new Prisma.Decimal(0)).toString();
    return {
      counts,
      walletBalances: dec(wallets._sum.balance),
      ledgerSum: dec(ledger._sum.amount),
      ledgerRows: ledger._count._all,
      paid: dec(paid._sum.amount),
      refunded: dec(refunded._sum.amount),
      codes: Object.fromEntries(codes.map((c) => [c.isUsed ? 'used' : 'unsold', c._count._all])),
    };
  }
}
