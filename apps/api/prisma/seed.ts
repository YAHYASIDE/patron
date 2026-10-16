/**
 * Patron — database seed entry for `npx prisma db seed` (local/dev, ts-node).
 * The actual logic lives in src/bootstrap/db-seed.ts so the production image can
 * run the same seed as compiled JS (see src/seed-runner.ts).
 *
 * Idempotent. Requires ENCRYPTION_KEY (32-byte hex) and SEED_ADMIN_PASSWORD.
 */
import { runSeed } from '../src/bootstrap/db-seed';

runSeed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
