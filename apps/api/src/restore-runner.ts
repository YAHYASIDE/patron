/* eslint-disable no-console */
/**
 * Rebuild the shop from a backup file (dist/restore-runner.js).
 *
 *   npx prisma migrate deploy                     # an empty database, migrated
 *   node dist/restore-runner.js patron-backup.json
 *
 * It refuses a database that already has customers or orders. The seeded
 * owner (SEED_ADMIN_EMAIL, default admin@patron.io) gets SEED_ADMIN_PASSWORD
 * back, since password hashes never leave the database; codes open again only
 * with the same ENCRYPTION_KEY the shop used before. See docs/DISASTER_RECOVERY.md.
 */
import { readFileSync } from 'fs';
import { hash as argon2Hash } from '@node-rs/argon2';
import { PrismaService } from './common/prisma/prisma.service';
import { BackupService, BackupFile } from './modules/admin-tools/backup.service';

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node dist/restore-runner.js <backup.json>');
  const file = JSON.parse(readFileSync(path, 'utf8')) as BackupFile;

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
    for (const [table, n] of Object.entries(written)) console.log(`  ${table.padEnd(18)} ${n}`);
    const check = await backup.fingerprint();
    console.log(`Wallet balances ${check.walletBalances} = ledger ${check.ledgerSum}: ${check.walletBalances === check.ledgerSum ? 'ok' : 'MISMATCH'}`);
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
