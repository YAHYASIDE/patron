# Backup, recovery and scaling

## On Render's free plan (the shop as it runs today)

The free Postgres instance is **deleted about 30 days after it is created**,
and the free plan has no WAL archiving or snapshots. Until the database moves
to a paid plan (the only real fix), the owner's downloaded backup is the
recovery path:

1. **Download a backup** from the dashboard (Settings → "نسخة احتياطية") at
   least weekly and after any busy day. Settings shows when the last one was
   downloaded (`GET /admin/backup/status`).
2. The file (version 2, `BackupService`) holds everything the shop is rebuilt
   from: customers, wallets with their whole ledger, orders, payments, refunds,
   reviews, tickets, customers' favourites, saved player IDs and price alerts,
   the catalogue with prices, banners, coupons, settings, and
   the code stock — unsold and delivered — as the AES-256-GCM ciphertext stored
   in the database. It holds no password hash, session, 2FA secret, sensitive
   input, provider key, notification, log or uploaded image.
3. **Keep `ENCRYPTION_KEY` with the backup, separately** (the owner generated
   it). Without it the codes in the backup cannot be opened by anyone,
   including the restored shop.

### Restoring

```bash
# a new, empty Postgres (DATABASE_URL), the same ENCRYPTION_KEY
npx prisma migrate deploy
SEED_ADMIN_PASSWORD=… node dist/restore-runner.js patron-backup-2026-10-20T08-15-30.json
```

The runner refuses a database that already has customers or orders, loads
everything in one transaction (a bad file changes nothing), gives the owner
account (`SEED_ADMIN_EMAIL`, default `admin@patron.io`) the seeded password
back, and checks that wallet balances still equal the ledger. Customers sign in
with their WhatsApp number as before; other staff reset their password. Receipt
images and uploaded logos do not come back (re-upload logos in Payment methods).

`test/integration/backup-restore.spec.ts` builds a shop, downloads the backup,
wipes the database, restores it and checks every balance, amount, row count and
code — it runs in CI on every change.

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
