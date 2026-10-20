/* eslint-disable no-console */
/**
 * Standalone staging-guard entry compiled into the image (dist/staging-guard-runner.js).
 * The Docker entrypoint runs it when STAGING=true.
 */
import { applyStagingGuard } from './bootstrap/staging-guard';

applyStagingGuard()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
