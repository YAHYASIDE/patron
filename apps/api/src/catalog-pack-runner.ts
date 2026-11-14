/* eslint-disable no-console */
/**
 * Standalone catalog-pack entry compiled into the image (dist/catalog-pack-runner.js).
 * The Docker entrypoint runs it when CATALOG_PACK=true: the catalog packs, then
 * the GamesDrop links (which wait until GamesDrop is connected).
 */
import { applyCatalogPack } from './bootstrap/catalog-pack';
import { applySupplierPack } from './bootstrap/supplier-pack';

applyCatalogPack()
  .then(() => applySupplierPack())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
