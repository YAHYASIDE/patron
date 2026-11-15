/* eslint-disable no-console */
/**
 * Standalone seed entry compiled into the image (dist/seed-runner.js).
 * The Docker entrypoint runs it when SEED_ON_BOOT=true.
 */
import { runSeed } from './bootstrap/db-seed';

runSeed()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
