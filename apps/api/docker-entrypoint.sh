#!/bin/sh
# Production entrypoint for the Patron API image.
# 1) apply any pending Prisma migrations (idempotent, advisory-locked),
# 2) optionally seed the database once (SEED_ON_BOOT=true),
# 3) optionally add the starter catalog once (CATALOG_PACK=true), then
# 4) hand off to the API. `exec` keeps the API as PID-equivalent so SIGTERM
#    reaches Node and in-flight requests drain.
#
# npm/npx are stripped from the runtime image, so Prisma is invoked directly
# via node against its CLI entry (prisma is a production dependency).
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations (prisma migrate deploy)…"
  node ./node_modules/prisma/build/index.js migrate deploy
fi

if [ "${SEED_ON_BOOT:-false}" = "true" ]; then
  echo "[entrypoint] seeding database (SEED_ON_BOOT=true)…"
  node dist/seed-runner.js
fi

# Insert-only starter catalog, applied once (a DB marker makes later boots a
# no-op). A failure here must not keep the API down, so it only warns.
if [ "${CATALOG_PACK:-false}" = "true" ]; then
  echo "[entrypoint] applying starter catalog pack (CATALOG_PACK=true)…"
  node dist/catalog-pack-runner.js || echo "[entrypoint] WARNING: catalog pack failed; starting API anyway"
fi

# A staging copy (render.staging.yaml) must never show the shop's real
# receiving numbers: replace them with test values once. If it fails the API
# stays down, so a test shop never starts with real numbers.
if [ "${STAGING:-false}" = "true" ]; then
  echo "[entrypoint] staging: replacing receiving numbers with test values…"
  node dist/staging-guard-runner.js
fi

echo "[entrypoint] starting API…"
exec node dist/main
