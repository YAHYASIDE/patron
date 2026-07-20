#!/usr/bin/env bash
# Logical backup with verification.
#
# An unverified backup is a hope, not a backup — so this restores into a
# throwaway database and checks row counts before declaring success.
set -euo pipefail

LABEL="${1:-scheduled}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="/backup/patron-${LABEL}-${STAMP}.dump"
: "${PGHOST:?}" "${PGUSER:?}" "${PGDATABASE:?}"

echo "→ dumping ${PGDATABASE}"
pg_dump --format=custom --compress=9 --no-owner --no-acl --file="${FILE}" "${PGDATABASE}"

echo "→ verifying restore into a scratch database"
SCRATCH="verify_${STAMP}"
createdb "${SCRATCH}"
trap 'dropdb --if-exists "${SCRATCH}"' EXIT
pg_restore --dbname="${SCRATCH}" --no-owner --exit-on-error "${FILE}"

for TABLE in orders payments wallet_transactions order_items; do
  SRC=$(psql -tAc "SELECT count(*) FROM \"${TABLE}\"" "${PGDATABASE}")
  DST=$(psql -tAc "SELECT count(*) FROM \"${TABLE}\"" "${SCRATCH}")
  if [ "${SRC}" != "${DST}" ]; then
    echo "::error::${TABLE} mismatch: source ${SRC}, restored ${DST}"; exit 1
  fi
  echo "  ${TABLE}: ${SRC} rows ✓"
done

echo "→ uploading"
aws s3 cp "${FILE}" "s3://${BACKUP_BUCKET}/postgres/" --storage-class STANDARD_IA
# Object Lock on the bucket is what makes this ransomware-resistant: an
# attacker with database credentials still cannot delete the backups.

echo "→ pruning local copies older than 7 days"
find /backup -name 'patron-*.dump' -mtime +7 -delete

echo "✓ backup complete: ${FILE}"
