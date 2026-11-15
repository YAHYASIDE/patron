/* eslint-disable no-console */
/**
 * Rebuild the shop from a backup file (dist/restore-runner.js).
 *
 *   npx prisma migrate deploy                     # an empty database, migrated
 *   node dist/restore-runner.js patron-backup.json
 *   BACKUP_PASSPHRASE='…' node dist/restore-runner.js patron-backup.patronbak
 *   BACKUP_ENCRYPTION_KEY=<64 hex> node dist/restore-runner.js patron-backup-daily-….patronbak
 *   node dist/restore-runner.js --check <file>    # open and count only, no database
 *
 * Plain JSON and encrypted `.patronbak` files are both accepted: a file locked
 * with a passphrase needs BACKUP_PASSPHRASE, a scheduled Drive copy needs the
 * BACKUP_ENCRYPTION_KEY it was made with. It refuses a database that already
 * has customers or orders. The seeded owner (SEED_ADMIN_EMAIL, default
 * admin@patron.io) gets SEED_ADMIN_PASSWORD back, since password hashes never
 * leave the database; codes open again only with the same ENCRYPTION_KEY the
 * shop used before. See docs/DISASTER_RECOVERY.md.
 */
import { readFileSync } from 'fs';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaService } from './common/prisma/prisma.service';
import { BackupService, BackupFile, inspectBackup } from './modules/admin-tools/backup.service';
import { readBackupFile } from './modules/admin-tools/backup-crypto';

async function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) throw new Error('Usage: node dist/restore-runner.js [--check] <backup.json | backup.patronbak>');

  const { encrypted, data } = await readBackupFile(readFileSync(path), {
    passphrase: process.env.BACKUP_PASSPHRASE,
    keyHex: process.env.BACKUP_ENCRYPTION_KEY,
  });
  const check = inspectBackup(data);
  console.log(`${encrypted ? 'Encrypted' : 'Plain'} backup, version ${check.version}, made ${check.exportedAt}: ${check.totalRows} rows`);
  if (!check.ok) throw new Error(`The file would not restore:\n  ${check.problems.join('\n  ')}`);
  if (checkOnly) {
    for (const [table, n] of Object.entries(check.counts)) console.log(`  ${table.padEnd(22)} ${n}`);
    return;
  }

  const file = data as BackupFile;
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const backup = new BackupService(prisma);
    const password = process.env.SEED_ADMIN_PASSWORD;
    const written = await backup.restore(file, {
      ownerEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@patron.io',
      ownerPasswordHash: password ? await argon2Hash(password) : undefined,
    });
    console.log(`Restored the backup of ${file.exportedAt}:`);
    for (const [table, n] of Object.entries(written)) console.log(`  ${table.padEnd(22)} ${n}`);
    const fp = await backup.fingerprint();
    console.log(`Wallet balances ${fp.walletBalances} = ledger ${fp.ledgerSum}: ${fp.walletBalances === fp.ledgerSum ? 'ok' : 'MISMATCH'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
