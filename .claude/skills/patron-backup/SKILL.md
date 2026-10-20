---
name: patron-backup
description: >-
  Patron backups and restore: the full version-2 JSON export, encrypted .patronbak
  files, Google Drive scheduled backups with retention, the backup log, failure
  alerts, verification and restore into a separate database. Use for "نسخة
  احتياطية", "استعادة", "backup", "restore", disaster recovery, or whenever a new
  table is added (it must be in the backup).
---

# Patron backup

## What exists
- `apps/api/src/modules/admin-tools/backup.service.ts`: TABLES in restore order (every table money
  and customers depend on), omitted secrets (password hashes, 2FA secrets, sensitive inputs,
  settings named secret/password/token/api_key/private), codes as stored ciphertext.
  `export()`, `restore()` (empty DB only, one transaction), `fingerprint()` (counts, wallet sums =
  ledger, payments, refunds, codes).
- Endpoints: `GET /admin/backup` (JSON download), `GET /admin/backup/status`, encrypted download,
  Drive connect/schedules, runs history, verify (dry run) — see the controller.
- `dist/restore-runner.js <file>`: restore into a migrated empty DB; encrypted files need
  BACKUP_PASSPHRASE or BACKUP_ENCRYPTION_KEY. The owner account gets SEED_ADMIN_PASSWORD back.
- Docs: `docs/DISASTER_RECOVERY.md`.

## Rules
- Production database is never touched by tests. Backups never go to GitHub or any public place
  (.gitignore blocks `*.patronbak`, `patron-backup-*.json`); keys never inside the backup.
- A new table → add it to TABLES in FK order (or note why it is left out) + the integration test.
- Codes open only with the same ENCRYPTION_KEY: the owner keeps it separately.

## Restore test (separate database)
```bash
export PGPASSWORD=patron
psql -h 127.0.0.1 -U patron -d postgres -c "CREATE DATABASE patron_restore_check"
cd apps/api && DATABASE_URL=postgresql://patron:patron@127.0.0.1:5432/patron_restore_check npx prisma migrate deploy
DATABASE_URL=... SEED_ADMIN_PASSWORD=... ENCRYPTION_KEY=... node dist/restore-runner.js <file>
```
Then compare per-table counts, wallet sum = ledger sum, payments/refunds sums and row hashes
(`md5(string_agg(to_jsonb(t)::text …))`) against the source; expected differences only: omitted
secret settings and the owner's updatedAt.

## Verify this skill worked
`test/integration/backup-restore.spec.ts` passes; a real file restored into a separate DB matches
the source as above; the dashboard shows the run in the backup history.
