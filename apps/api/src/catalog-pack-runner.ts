/* eslint-disable no-console */
/**
 * Standalone catalog-pack entry compiled into the image (dist/catalog-pack-runner.js).
 * The Docker entrypoint runs it when CATALOG_PACK=true: the catalog packs, then
 * the GamesDrop links (which wait until GamesDrop is connected), then showing
 * the new GamesDrop products the owner approved.
 */
import { applyCatalogPack } from './bootstrap/catalog-pack';
import { applySupplierPack, showNewSupplierProducts } from './bootstrap/supplier-pack';

applyCatalogPack()
  .then(() => applySupplierPack())
  .then(() => showNewSupplierProducts())
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
