/* eslint-disable no-console */
/**
 * Standalone catalog-pack entry compiled into the image (dist/catalog-pack-runner.js).
 * The Docker entrypoint runs it when CATALOG_PACK=true.
 */
import { applyCatalogPack } from './bootstrap/catalog-pack';

applyCatalogPack()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
