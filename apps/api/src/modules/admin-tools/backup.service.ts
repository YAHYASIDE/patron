import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * A full backup the shop can be rebuilt from, and the restore that does it.
 *
 * Render's free database is deleted after about 30 days, so the backup has to
 * hold everything money depends on: customers and their wallets with the whole
 * ledger, orders with payments and refunds, the catalogue, and the codes the
 * owner paid for — unsold stock and delivered ones — plus what customers keep in
 * their account (favourites, saved player IDs, price alerts). Codes travel as the
 * ciphertext already stored (AES-256-GCM): the file never holds a readable
 * code, and only the same ENCRYPTION_KEY can open them after a restore.
 *
 * Platform V2 adds passkeys (public keys only: a passkey cannot sign anyone in
 * without the phone that holds its private half), account-recovery requests,
 * USDT orders with their history, agents with their payouts and commissions,
 * and the bank notifications the owner's phone read.
 *
 * Left out on purpose: password hashes, 2FA secrets, sessions, verification
 * codes and WebAuthn challenges, receipt images and other uploads, provider API
 * keys, notifications (customer and staff), the backup log itself, audit and
 * event logs, and settings whose name says they are secret. After a restore
 * staff set a new password (the restore sets the seeded owner's one) and
 * customers sign in with their WhatsApp number as before.
 *
 * The markets and intelligence center travel too: countries with the payment
 * methods and product rules research found and the owner's decisions on them,
 * discoveries with their decision log, and the agents' run log.
 *
 * Version 3 only adds tables: a version-2 file still restores (the new tables
 * stay empty), and so does a version-3 file from before the markets tables (the
 * countries the migration seeded stay as they are).
 */
export const BACKUP_VERSION = 3;
/** Every version this code can restore. */
export const RESTORABLE_VERSIONS = [2, 3];

/**
 * Settings that never leave the database: names that say they hold a secret,
 * and this deployment's Google Drive connection (a restored shop reconnects).
 */
const SECRET_SETTING = /secret|password|token|api[_-]?key|private|^backup\.gdrive\./i;
export const isSecretSetting = (key: string) => SECRET_SETTING.test(key);

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
  /** Rows to change before they leave (e.g. drop a sensitive value, or turn bytes into text). */
  map?: (row: Row) => Row;
  /** The way back for `map` when a value had to change form to fit in JSON. */
  unmap?: (row: Row) => Row;
  /**
   * Columns that point at a table restored later (users.referredByAgentId →
   * agents, while agents point back at users). They are written as null with
   * the row and set once every table is in, inside the same transaction.
   */
  deferred?: string[];
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
  { model: 'user', omit: ['passwordHash', 'twoFaSecretEnc'], deferred: ['referredByAgentId'], orderBy: { createdAt: 'asc' } },
  { model: 'userRole' },
  // the public half of a fingerprint/face sign-in; bytes and the counter travel as text
  {
    model: 'passkey',
    orderBy: { createdAt: 'asc' },
    map: (row) => ({ ...row, publicKey: Buffer.from(row.publicKey as Uint8Array).toString('base64'), counter: String(row.counter) }),
    unmap: (row) => ({ ...row, publicKey: Buffer.from(String(row.publicKey), 'base64'), counter: BigInt(String(row.counter)) }),
  },
  { model: 'accountRecoveryRequest', orderBy: { createdAt: 'asc' } },
  // before orders: an order may name the agent who brought the customer
  { model: 'agent', orderBy: { createdAt: 'asc' } },
  // what customers keep in their account: favourite brands, saved player IDs (never a
  // password: only non-sensitive fields are ever saved) and price alerts
  { model: 'favorite' },
  { model: 'savedInput' },
  { model: 'priceWatch' },
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
  { model: 'agentPayout', orderBy: { createdAt: 'asc' } },
  // after the order it is earned on and the payout that settled it
  { model: 'commission', orderBy: { createdAt: 'asc' } },
  // the payment proof is an upload, which the backup does not hold
  { model: 'usdtOrder', clear: ['proofUploadId'], orderBy: { createdAt: 'asc' } },
  { model: 'usdtOrderEvent', orderBy: { createdAt: 'asc' } },
  // evidence the owner's phone read from bank apps (ids of payments, no foreign keys)
  { model: 'bankNotification', orderBy: { receivedAt: 'asc' } },
  { model: 'review', orderBy: { createdAt: 'asc' } },
  { model: 'supportTicket', orderBy: { createdAt: 'asc' } },
  { model: 'banner', orderBy: { sortOrder: 'asc' } },
  // markets: each country before the methods and rules researched for it (a method's accountId is
  // the id of a manual account inside the payments setting, not a foreign key)
  { model: 'marketCountry', orderBy: { code: 'asc' } },
  { model: 'marketPaymentMethod', orderBy: { createdAt: 'asc' } },
  { model: 'productMarketRule', orderBy: { createdAt: 'asc' } },
  // the intelligence center: discoveries with the owner's decisions, and the agents' run log
  { model: 'discovery', orderBy: { createdAt: 'asc' } },
  { model: 'discoveryDecision', orderBy: { createdAt: 'asc' } },
  { model: 'agentRun', orderBy: { startedAt: 'asc' } },
  { model: 'systemSetting', orderBy: { key: 'asc' } },
];

/**
 * Tables a fresh, migrated database already has rows in; the backup's rows replace them (the
 * markets migration seeds the countries the store serves).
 */
const REPLACED_ON_RESTORE = ['systemSetting', 'fxRate', 'currency', 'marketCountry'];

/**
 * Roles and permissions are seeded by migrations too (Platform V2 adds the agent
 * role and permissions such as backup.manage). The backup's rows replace them,
 * but whatever the migrations know and the backup does not (a backup taken
 * before those migrations) is put back with its grants, so a restored shop
 * keeps every feature of the code it runs.
 */
interface SeededAccess {
  roles: Row[];
  permissions: Row[];
  grants: Array<{ role: string; key: string }>;
}

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

/** What a dry run found in a backup file: nothing is written. */
export interface BackupCheck {
  ok: boolean;
  version: number | null;
  exportedAt: string | null;
  /** Rows per table as found in the file. */
  counts: Record<string, number>;
  totalRows: number;
  /** Plain-language problems; empty when the file would restore. */
  problems: string[];
}

/** The tables a backup holds, in restore order. */
export const BACKUP_TABLES: readonly string[] = TABLES.map((t) => t.model);

/**
 * Check a parsed file the way restore() would, without a database: the version,
 * that every table is a list of rows, that the counts it announces match the rows
 * it carries, and that it holds no table this code does not know.
 */
export function inspectBackup(file: unknown): BackupCheck {
  const problems: string[] = [];
  const f = (file && typeof file === 'object' ? file : {}) as Partial<BackupFile>;
  const version = typeof f.version === 'number' ? f.version : null;
  if (version === null || !RESTORABLE_VERSIONS.includes(version)) {
    problems.push(`Not a patron backup this version can restore (found version ${version ?? 'none'}, expected ${RESTORABLE_VERSIONS.join(' or ')})`);
  }
  const tables = f.tables && typeof f.tables === 'object' ? f.tables : null;
  if (!tables) problems.push('The file has no tables');
  const counts: Record<string, number> = {};
  for (const model of BACKUP_TABLES) {
    const rows = tables?.[model];
    if (rows === undefined) {
      counts[model] = 0;
      continue;
    }
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object')) {
      problems.push(`Table ${model} is not a list of rows`);
      counts[model] = 0;
      continue;
    }
    counts[model] = rows.length;
    const announced = f.counts?.[model];
    if (typeof announced === 'number' && announced !== rows.length) {
      problems.push(`Table ${model} announces ${announced} rows but holds ${rows.length}`);
    }
  }
  for (const name of Object.keys(tables ?? {})) {
    if (!BACKUP_TABLES.includes(name)) problems.push(`Unknown table ${name}`);
  }
  if (tables && !(counts.currency > 0)) problems.push('The file holds no currencies: a real shop always has some');
  return {
    ok: problems.length === 0,
    version,
    exportedAt: typeof f.exportedAt === 'string' ? f.exportedAt : null,
    counts,
    totalRows: Object.values(counts).reduce((a, b) => a + b, 0),
    problems,
  };
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
        .filter((r) => spec.model !== 'systemSetting' || !isSecretSetting(String(r.key)))
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
    if (!file || !RESTORABLE_VERSIONS.includes(file.version) || typeof file.tables !== 'object' || !file.tables) {
      throw new BadRequestException(`Not a patron backup this version can restore (expected version ${RESTORABLE_VERSIONS.join(' or ')})`);
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
        type Delegate = {
          createMany(a: Row): Promise<{ count: number }>;
          deleteMany(a?: Row): Promise<unknown>;
          updateMany(a: Row): Promise<unknown>;
        };
        const db = tx as unknown as Record<string, Delegate>;
        // rows a migration seeded are replaced (rates first: they point at currencies), then everything is inserted in order
        for (const model of REPLACED_ON_RESTORE) {
          if (file.tables[model]?.length) await db[model].deleteMany({});
        }
        const replacesAccess = !!(file.tables.role?.length || file.tables.permission?.length);
        const seeded = replacesAccess ? await this.seededAccess(tx) : null;
        if (replacesAccess) {
          await tx.rolePermission.deleteMany({});
          await tx.permission.deleteMany({});
          await tx.role.deleteMany({});
        }
        // column → value → ids, set once the table they point at is in
        const later: Array<{ model: string; column: string; byValue: Map<string, string[]> }> = [];
        for (const spec of TABLES) {
          const rows = file.tables[spec.model] ?? [];
          if (!rows.length) {
            written[spec.model] = 0;
            continue;
          }
          const data = rows.map((r) => {
            const row = restorable(spec.model, spec.unmap ? spec.unmap(r) : r);
            for (const column of spec.deferred ?? []) row[column] = null;
            return row;
          });
          for (const column of spec.deferred ?? []) {
            const byValue = new Map<string, string[]>();
            for (const r of rows) {
              const v = r[column];
              if (typeof v === 'string') byValue.set(v, [...(byValue.get(v) ?? []), String(r.id)]);
            }
            if (byValue.size) later.push({ model: spec.model, column, byValue });
          }
          const { count } = await db[spec.model].createMany({ data });
          written[spec.model] = count;
        }
        for (const { model, column, byValue } of later) {
          for (const [value, ids] of byValue) {
            await db[model].updateMany({ where: { id: { in: ids } }, data: { [column]: value } });
          }
        }
        if (seeded) await this.keepSeededAccess(tx, seeded);
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

  private async seededAccess(tx: Prisma.TransactionClient): Promise<SeededAccess> {
    const [roles, permissions, grants] = await Promise.all([
      tx.role.findMany(),
      tx.permission.findMany(),
      tx.rolePermission.findMany({ select: { role: { select: { name: true } }, permission: { select: { key: true } } } }),
    ]);
    return {
      roles: roles as unknown as Row[],
      permissions: permissions as unknown as Row[],
      grants: grants.map((g) => ({ role: g.role.name, key: g.permission.key })),
    };
  }

  /** Put back the roles and permissions the backup does not know, with their grants. */
  private async keepSeededAccess(tx: Prisma.TransactionClient, seeded: SeededAccess) {
    const roleIds = new Map((await tx.role.findMany({ select: { id: true, name: true } })).map((r) => [r.name, r.id]));
    const permIds = new Map((await tx.permission.findMany({ select: { id: true, key: true } })).map((p) => [p.key, p.id]));
    const newRoles = seeded.roles.filter((r) => !roleIds.has(String(r.name)));
    const newPerms = seeded.permissions.filter((p) => !permIds.has(String(p.key)));
    if (newRoles.length) await tx.role.createMany({ data: newRoles as never });
    if (newPerms.length) await tx.permission.createMany({ data: newPerms as never });
    for (const r of newRoles) roleIds.set(String(r.name), String(r.id));
    for (const p of newPerms) permIds.set(String(p.key), String(p.id));
    const added = new Set([...newRoles.map((r) => `r:${r.name}`), ...newPerms.map((p) => `p:${p.key}`)]);
    const grants = seeded.grants
      .filter((g) => added.has(`r:${g.role}`) || added.has(`p:${g.key}`))
      .map((g) => ({ roleId: roleIds.get(g.role), permissionId: permIds.get(g.key) }))
      .filter((g): g is { roleId: string; permissionId: string } => !!g.roleId && !!g.permissionId);
    if (grants.length) await tx.rolePermission.createMany({ data: grants, skipDuplicates: true });
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
