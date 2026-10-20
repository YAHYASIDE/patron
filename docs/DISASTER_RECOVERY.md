# Backup, recovery and scaling

## On Render's free plan (the shop as it runs today)

The free Postgres instance is **deleted about 30 days after it is created**,
and the free plan has no WAL archiving or snapshots. Until the database moves
to a paid plan (the only real fix), the owner's backups are the recovery path.
Everything below is in the dashboard: **Settings → النسخ الاحتياطي**.

### What a backup holds

One file (`BackupService`, format version 3; version 2 files still restore)
with everything the shop is rebuilt from: customers, wallets with their whole
ledger, orders, payments, refunds, reviews, tickets, customers' favourites,
saved player IDs and price alerts, the catalogue with prices, banners, coupons,
settings, the code stock — unsold and delivered — as the AES-256-GCM ciphertext
stored in the database, and the Platform V2 tables: passkeys (public keys
only), account-recovery requests, USDT orders and their history, agents, their
payouts and commissions, and bank notifications.

It holds no password hash, session, 2FA secret, WebAuthn challenge, sensitive
input, provider key, notification (customer or staff), log, backup log,
uploaded image or USDT payment proof, no setting whose name says it is secret,
and not this deployment's Google Drive connection (`backup.gdrive.*`).

### Three ways to keep a copy

1. **Plain download** (`GET /admin/backup`, permission `settings.manage`): a
   `patron-backup-<time>.json` file. Anyone holding it can read customers'
   names, phones and balances: keep it somewhere private.
2. **Encrypted download** (`POST /admin/backup/encrypted`, `backup.manage`):
   the same backup in a `.patronbak` file locked with a **passphrase the owner
   types** (at least 12 characters, typed twice). The key is made from it with
   scrypt (N=2^17, r=8, p=1, random salt per file) and the file is sealed with
   AES-256-GCM. The passphrase is never stored or logged. **A lost passphrase
   cannot be recovered by anyone: that file is then useless.** Write it down
   and keep it apart from the file.
3. **Scheduled copies to Google Drive** (`backup.manage`): daily and/or weekly
   at an hour the owner picks (UTC, which is Mauritania's time), encrypted with
   the server's `BACKUP_ENCRYPTION_KEY`, uploaded to a "Patron backups" folder
   in the owner's Drive. The owner chooses how many copies of each kind to
   keep; older ones go to the Drive trash (recoverable for 30 days). Retention
   only ever lists files the app itself created and tagged, and the app's
   Google permission (`drive.file`) does not let it see anything else in the
   Drive. "إرسال نسخة الآن" sends one immediately.

A BullMQ job (`backups` queue, every 15 minutes) checks whether the current
daily or weekly slot already has a copy; a free server that slept through the
hour takes the copy when it wakes. A failed slot is retried on the next ticks,
three times at most, then waits for the next slot.

Every attempt — download or Drive — is a row in `backup_runs` (trigger,
destination, encrypted or not, size, SHA-256, rows per table, error) shown as
the history table in Settings (`GET /admin/backup/runs`). A failure raises one
**urgent** notice in the owner's notification center (`backup.failed`); the
next backup that works closes it.

**Verify a file** (`POST /admin/backup/verify`): upload a `.json` or
`.patronbak` (with its passphrase; scheduled copies open with the server's
key) and the server decrypts it, parses it and checks the version and the rows
of every table, writing nothing. Do this now and then with a file taken from
the Drive.

### Keys the owner must keep, outside the server and outside Google Drive

| Key | What it opens | Lost means |
|---|---|---|
| `ENCRYPTION_KEY` | the codes (stock and delivered), provider keys, the stored Drive connection | codes in every backup are unreadable forever |
| `BACKUP_ENCRYPTION_KEY` | every scheduled Drive copy | those copies cannot be opened |
| each download passphrase | that one `.patronbak` file | that file cannot be opened |

Keep them in a password manager and on paper, never next to the backups and
never in the Drive the copies go to. They are never written into a backup.

### Setting up Google Drive and the schedule (once)

1. **A backup key** on the server: generate it on your own device with
   `openssl rand -hex 32` and add it to the API's environment (Render → the API
   service → Environment) as `BACKUP_ENCRYPTION_KEY`. Save a copy as above.
2. **A Google OAuth client** (Google Cloud Console, free):
   1. Create a project (e.g. "Patron backups").
   2. *APIs & Services → Library*: enable **Google Drive API**.
   3. *OAuth consent screen*: user type **External**, app name, your email;
      add the scope `https://www.googleapis.com/auth/drive.file` only; add your
      Google account as a **test user**. Then *Publish app* ("In production"):
      while the app stays in "Testing", Google expires its refresh token after
      7 days and the schedule stops. `drive.file` is not a restricted scope, so
      publishing needs no Google review (Google may show "unverified app" on the
      consent screen: continue, it is your own app).
   4. *Credentials → Create credentials → OAuth client ID*, type **Web
      application**, authorised redirect URI exactly
      `https://<api host>/api/v1/admin/backup/gdrive/callback`.
   5. Put the client ID, client secret and that same redirect URI on the API as
      `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
3. Make sure the dashboard's address is in the API's `CORS_ORIGINS`: Google
   sends you back to that page after consent.
4. In Settings → النسخ الاحتياطي: **ربط Google Drive**, accept on Google's page,
   then switch on the daily and/or weekly copy, pick the hour and how many to
   keep, **حفظ الجدول**, and press **إرسال نسخة الآن** once to see a first copy
   arrive in the Drive.

Until those variables are set the dashboard says which ones are missing, and
the API answers `GDRIVE_NOT_CONFIGURED` / `BACKUP_KEY_NOT_CONFIGURED`. The
refresh token Google returns is stored encrypted with `ENCRYPTION_KEY` (setting
`backup.gdrive.refresh_token`); **فصل** revokes it at Google, forgets it and
switches the schedule off. If `ENCRYPTION_KEY` ever changes, disconnect and
connect again.

### Restoring

```bash
# a new, empty Postgres (DATABASE_URL), the same ENCRYPTION_KEY
npx prisma migrate deploy
node dist/restore-runner.js --check <file>      # open and count only, no database
SEED_ADMIN_PASSWORD=… node dist/restore-runner.js patron-backup-2026-10-20T08-15-30.json
SEED_ADMIN_PASSWORD=… BACKUP_PASSPHRASE='…' node dist/restore-runner.js patron-backup-2026-10-20T08-15-30.patronbak
SEED_ADMIN_PASSWORD=… BACKUP_ENCRYPTION_KEY=… node dist/restore-runner.js patron-backup-daily-2026-10-20T02-00-05.patronbak
```

A file downloaded with a passphrase needs `BACKUP_PASSPHRASE`; a scheduled
Drive copy needs the `BACKUP_ENCRYPTION_KEY` it was made with (download it from
the "Patron backups" folder first). Type secrets into the shell with care (a
leading space keeps them out of most shells' history) and unset them after.

The runner refuses a database that already has customers or orders, loads
everything in one transaction (a bad file changes nothing), gives the owner
account (`SEED_ADMIN_EMAIL`, default `admin@patron.io`) the seeded password
back, and checks that wallet balances still equal the ledger. Roles and
permissions come from the backup; any the migrations add that an older backup
does not know (such as `backup.manage`) are kept with their grants. Customers
sign in with their WhatsApp number as before; other staff reset their
password; passkeys keep working. Receipt images and uploaded logos do not come
back (re-upload logos in Payment methods). After a restore on a new
deployment, connect Google Drive again: the connection is not in the backup.

`test/integration/backup-restore.spec.ts` builds a shop (with agents, USDT
orders, passkeys…), backs it up, wipes the database, restores it — from plain
JSON, from a passphrase file and from a scheduled copy — and checks every
balance, amount, row count and code; it runs in CI on every change. Backup
files can never be committed: `.gitignore` blocks `*.patronbak` and
`patron-backup-*.json`.

## Objectives

| Metric | Target | Basis |
|---|---|---|
| RPO (max data loss) | 5 minutes | WAL archived continuously; a lost order is a real refund |
| RTO (max downtime) | 30 minutes | Beyond this, customers go elsewhere |
| Backup retention | 30 days daily, 12 months monthly | Chargeback windows run to 180 days |
| Restore drill | Quarterly | An untested backup is a hope, not a backup |

## Backup strategy

Three layers, because each fails differently:

1. **Continuous WAL archiving** → point-in-time recovery to any second within
   the retention window. This is what delivers the 5-minute RPO.
2. **Nightly logical dump** (`deploy/scripts/backup.sh`) → survives corruption
   that a physical backup would faithfully reproduce, and can be restored into
   a different Postgres version.
3. **Pre-deploy snapshot** → taken by the deploy pipeline *before* migrations
   run. A migration without a restore point is a decision to accept data loss.

Every dump is **verified by restoring it** into a scratch database and comparing
row counts on `orders`, `payments`, `wallet_transactions` and `order_items`. An
unverified backup has a habit of being empty exactly when it matters.

Backups go to object storage with **Object Lock enabled**. That is what makes
them ransomware-resistant: an attacker holding database credentials still cannot
delete the backups.

### What is *not* backed up, deliberately

- **Redis.** Queue state is reconstructible: the outbox holds every unpublished
  intent, and BullMQ jobs are idempotent. Losing Redis costs latency, not
  correctness.
- **Encrypted payloads are backed up, but the key is not.** `ENCRYPTION_KEY`
  lives in the secret manager with its own backup path. A database dump alone is
  useless without it — which is the point.

> **The single most important thing in this document:** restoring the database
> without `ENCRYPTION_KEY` gives you orders whose delivered codes, provider
> credentials and 2FA secrets are permanently unreadable. Verify the key is
> recoverable *separately*, and test that too.

## Recovery scenarios

### Accidental data loss (bad migration, mistaken delete)

```bash
# 1. Stop writes.
kubectl -n patron scale deployment/patron-api --replicas=0
kubectl -n patron scale deployment/patron-worker --replicas=0

# 2. Restore to just before the incident.
pg_restore --clean --if-exists --no-owner \
  --dbname="$DATABASE_URL" /backup/patron-pre-deploy-v1.4.0.dump

# 3. Reconcile before letting traffic back in.
psql "$DATABASE_URL" -f deploy/scripts/reconcile.sql

# 4. Resume.
kubectl -n patron scale deployment/patron-worker --replicas=2
kubectl -n patron scale deployment/patron-api --replicas=3
```

**Reconciliation is not optional.** Between the backup and the restore, payments
may have been captured at the gateway that the restored database has no record
of. Those customers have paid and own nothing. The reconciliation query lists
gateway-captured payments with no local record; each is settled manually.

### Complete database loss

1. Provision a new instance from the latest base backup.
2. Replay WAL to the last archived segment (recovers to within the RPO).
3. Point `DATABASE_URL` at it and roll the deployment.
4. Run reconciliation against the payment gateway for the gap window.
5. Re-run the FX sync — rates will be stale, and stale rates on a 604:1 pair
   are expensive.

### Redis loss

No restore needed. Bring Redis back empty; the outbox relay republishes every
`PENDING` event within a second, and repeatable jobs re-register on worker boot.
Watch `patron_outbox_pending` drain.

### Provider credential compromise

1. Rotate at the provider.
2. `POST /admin/providers/:id/rotate-key` (audited).
3. Review `provider_calls` for the exposure window.
4. Set the provider inactive if unauthorised purchases are suspected — the
   engine fails over to the secondary automatically.

### `ENCRYPTION_KEY` compromise

**There is currently no rotation mechanism** — see `SECURITY_AUDIT.md` §6.4.
Every stored code, provider credential and 2FA secret must be treated as
compromised. Immediate actions: rotate all provider credentials, force 2FA
re-enrolment, and treat undelivered codes as spent.

This is the largest single gap in the platform's recovery posture.

## Rollback

Application rollback is a `kubectl rollout undo` — the pipeline does it
automatically on a failed verify.

**Migrations do not roll back.** Every migration must therefore be
backward-compatible with the previous application version:

- Add columns as nullable, or with a default.
- Never rename or drop in the same release that stops using the old name —
  expand, deploy, contract across two releases.
- Never narrow a type in a single step.

A migration that violates this turns a routine rollback into a restore.

## Scaling

### Current capacity

Roughly 500 orders/minute on 3 API pods and 2 workers, bounded by the fulfilment
queue rather than by CPU.

### What to scale, in order

1. **Workers first.** Fulfilment latency is the customer-visible number, and
   worker autoscaling keys on queue depth rather than CPU — a worker blocked on
   a slow provider uses no CPU while the backlog grows, so CPU-based scaling
   would never fire.
2. **API pods** on CPU at 65%.
3. **Postgres connections.** Each pod holds a Prisma pool; at ~20 pods the
   connection count becomes the ceiling. Introduce PgBouncer in transaction
   mode before that point — but note it is incompatible with prepared
   statements, so `pgbouncer=true` must be set on the connection string.
4. **Read replica for reporting.** Reports are the heaviest queries and do not
   need write consistency. Route `ReportsService` and `AnalyticsService` to a
   replica; everything else must stay on the primary, because the wallet ledger
   cannot tolerate replica lag.

### Known scaling limits

| Component | Limit | Mitigation |
|---|---|---|
| Wallet writes per user | Serialised by `FOR UPDATE` | Inherent and correct — do not "optimise" it away |
| Outbox relay | ~100 events/sec per instance | Multiple relays; `SKIP LOCKED` already supports it |
| Provider rate limits | Provider-imposed | Failover; negotiate higher limits |
| Reporting | Full-range aggregations | Read replica, then materialised daily rollups |

### What not to scale

Do not increase fulfilment worker concurrency beyond ~10 per pod. Each job may
spend real money, providers rate-limit, and a queue of failed purchases is worse
than a queue of waiting ones.
