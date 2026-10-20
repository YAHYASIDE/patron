# Patron API

NestJS + Prisma + PostgreSQL + BullMQ backend for the Patron digital products
marketplace. Sells game top-ups, gift cards, subscriptions and software licenses
across USD, EUR, MRU and XOF, fulfilled through external providers.

## Status

| Module | State |
|---|---|
| Database — 39 tables, 15 enums | ✅ |
| Auth (JWT + RBAC, refresh rotation) | ✅ |
| Users / Roles / Permissions | ✅ |
| Catalog + PricingService | ✅ |
| Checkout quotes (15-min price lock) | ✅ |
| Orders + derived state machine | ✅ |
| Payments (wallet + card gateway abstraction) | ✅ |
| Provider Engine (FazerCards → FoxReload failover) | ✅ |
| Wallet ledger + Refunds | ✅ |
| Notifications (in-app / email / push) | ✅ |
| BullMQ queues + transactional outbox | ✅ |
| Test suite (unit / integration / e2e) | ✅ |
| Admin reporting & dashboards | ✅ |
| Observability (logs, metrics, health) | ✅ |
| Distributed tracing (OpenTelemetry) | ✅ |
| Resilience / stress / load tests | ✅ |
| Deployment (Docker, K8s, Nginx) | ✅ |
| CI/CD (GitHub Actions) | ✅ |
| Security audit | ✅ |
| Scale hardening (keyset, rollups, retention) | ✅ |
| Operations manual & developer guide | ✅ |
| Frontend / Flutter | ⬜ not started |

## Running it

```bash
docker compose up -d postgres redis
npm install
cp .env.example .env

openssl rand -hex 32   # → ENCRYPTION_KEY
openssl rand -hex 32   # → JWT_ACCESS_SECRET
openssl rand -hex 32   # → JWT_REFRESH_SECRET

npx prisma migrate dev && npx prisma generate && npm run db:seed

npm run start:dev          # API + Swagger at /docs
npm run start:worker:dev   # queues + outbox relay (separate process)
```

Workers run as their own process so a 20-second provider call never competes
with API request latency, and they scale and restart independently.

## Architecture

```
src/
  common/          prisma · crypto · outbox · idempotency · money · guards
                   context (correlation ids) · logging · metrics · health
  modules/
    auth/          JWT, refresh rotation, OTP, lockout
    users/ roles/ permissions/
    catalog/       categories · games · products · PricingService
    orders/        QuotesService (price lock) · OrdersService · state machine
    payments/      PaymentsService · gateways/{wallet,stripe} · webhooks
    refunds/       request → approve → process
    wallet/        per-currency ledger with row locking
    providers/     adapters/{fazercards,foxreload} · registry · engine
    notifications/ channels/{in-app,email,push} · templates
    fx/            append-only rate history + feed sync
    reports/       revenue · profit · providers · products · customers ·
                   currencies · refunds · failures · queues
    queues/        BullMQ queues · outbox relay · processors
```

Every architectural decision is recorded in [`docs/adr/`](docs/adr/README.md).
Start there — the *why* lives in those eighteen documents, not in the code.

| Document | For |
|---|---|
| [`docs/adr/`](docs/adr/README.md) | Why the system is shaped this way |
| [`DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) | Working on it |
| [`OPERATIONS.md`](docs/OPERATIONS.md) | Running it |
| [`PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | Scores, blockers, honest gaps |
| [`SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) | Threat-by-threat findings |
| [`PERFORMANCE_REVIEW.md`](docs/PERFORMANCE_REVIEW.md) | Behaviour at 1M orders |
| [`QUERY_REVIEW.md`](docs/QUERY_REVIEW.md) | Plans, indexes, locks, batching |
| [`DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md) | Backup, restore, scaling |

## The parts worth understanding first

**Checkout is two steps.** A quote freezes sell price, provider cost, FX rate
and tax for 15 minutes; the order copies those values verbatim and performs no
pricing arithmetic. See [ADR 001](docs/adr/001-checkout-quote-price-lock.md).

**Nothing is enqueued directly.** State changes write an outbox event in the
same transaction; a relay publishes to BullMQ. A committed order always has its
fulfilment job, and a rolled-back one never does. See
[ADR 003](docs/adr/003-transactional-outbox.md).

**The provider pipeline has no provider names in it.** Adding a third provider
is one adapter class plus a database row. See
[ADR 002](docs/adr/002-provider-engine-strategy.md).

**Money never touches a float.** All arithmetic is `Prisma.Decimal`; the wallet
is an append-only ledger guarded by `SELECT ... FOR UPDATE`. See
[ADR 005](docs/adr/005-wallet-ledger.md).

## Concurrency and idempotency

| Risk | Guard |
|---|---|
| Double-tapped checkout | `Idempotency-Key` + conditional quote consumption |
| Replayed payment webhook | Unique `(source, eventId)` + conditional capture |
| Two workers fulfilling one item | Conditional claim `WHERE status IN (PENDING, FAILED)` |
| Concurrent wallet debits | `SELECT ... FOR UPDATE` + ledger CHECK constraints |
| Provider retry after timeout | Deterministic key from `(item, provider, attempt)` |
| Duplicate outbox publish | BullMQ `jobId` derived from the event id |
| Lost job on crash | Transactional outbox |
| Concurrent order updates | `version` column, incremented on every write |

## Security posture

- Refresh token rotation with reuse detection — a replayed token revokes the
  whole family.
- Login runs a bcrypt comparison even for unknown emails: no timing or message
  oracle for account enumeration.
- Lockout after 5 failures in 15 minutes, tracked per email *and* per IP.
- Blocking a user, changing a password or resetting one revokes live sessions.
- Provider keys, delivered codes, 2FA secrets and sensitive checkout inputs are
  AES-256-GCM at rest. Card PAN/CVV are never stored.
- Delivered codes are revealed through a separate, audited endpoint — they are
  not embedded in order payloads, logs or list responses.
- Webhook signatures are verified against the raw body with constant-time
  comparison, and Stripe timestamps older than 5 minutes are rejected.
- Permissions are resolved per request, so revocation is immediate.

## Observability

Structured logs, Prometheus metrics, three health endpoints, and distributed
tracing. When tracing is enabled the correlation id *is* the trace id, so
jumping from a log line to its trace is a copy-paste. Scrape config, alert rules
and Grafana layouts: [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md).

## Deployment

Multi-stage Dockerfile (non-root, read-only root filesystem), production
compose, and Kubernetes manifests with HPA, PDB and default-deny NetworkPolicy
in [`deploy/`](deploy/). CI/CD in [`.github/workflows/`](.github/workflows/):
lint and type-check, migration drift detection, unit → integration → e2e,
dependency audit, secret scanning, CodeQL, Trivy image scan, then a staging
deploy gated by a load test before production.

Backup, recovery runbooks and scaling limits:
[`docs/DISASTER_RECOVERY.md`](docs/DISASTER_RECOVERY.md).

## Production readiness review

Full findings from the phase-3 review — race conditions, indexes, transaction
boundaries, security, performance — are in
[`docs/BACKEND_REVIEW.md`](docs/BACKEND_REVIEW.md).

**Ready:** schema and constraints, auth, RBAC, catalog, quote/order/payment
flow, provider failover, wallet ledger, refunds, queues, outbox, idempotency,
reporting, observability, test suite, ADRs.

Security findings: [`docs/SECURITY_AUDIT.md`](docs/SECURITY_AUDIT.md) — 4 fixed,
3 accepted risks documented, 11 controls verified.

Full scoring and blocker list:
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) — **8.5/10 overall.**

**Blocking go-live — needs you, not more code:**

1. **Provider adapter response shapes are unverified.** Written from integration
   specs; FazerCards and FoxReload field names must be confirmed against their
   sandboxes before real money moves. Isolated to two files by design.
2. **No FX feed is configured.** `FX_FEED_URL` is unset, so rates are whatever
   the seed inserted. On a 604:1 pair, stale rates get expensive fast. The sync
   job, staleness alert and >15%-move sanity check all exist; the feed does not.
3. **No encryption-key rotation mechanism.** If `ENCRYPTION_KEY` is ever
   compromised there is no path to re-encrypt existing ciphertext — every stored
   code, provider credential and 2FA secret would have to be treated as lost.
   Fixing it means a `keyVersion` column and a background re-encryption job.
   Small work; flagged because an auditor will ask.
4. **Kubernetes Secret manifests ship placeholders.** Wire up External Secrets,
   Vault or SOPS before first deploy — a `Secret` in git is base64, not
   encryption.

**Blocking go-live — I can do these:**

5. **Migration SQL is hand-written** (Prisma engines could not be downloaded in
   the build environment). CI runs a `migrate diff` drift check; run it once
   locally before the first deploy.
6. **Email and push are unconfigured**, so OTP delivery and order notifications
   fail closed and log a warning rather than sending silently.

**Known deliberate trade-offs:**

- Quotes do not reserve stock ([ADR 001](docs/adr/001-checkout-quote-price-lock.md)).
- Manual price overrides do not follow base-price changes
  ([ADR 007](docs/adr/007-multi-currency.md)).
- Wallet drift alerts rather than auto-correcting
  ([ADR 005](docs/adr/005-wallet-ledger.md)).
- Order and quote numbering are deliberately duplicated
  ([review 4.1](docs/BACKEND_REVIEW.md)).

## Testing

```bash
npm run test:unit         # pure logic, no I/O
npm run test:integration  # real Postgres via testcontainers
npm run test:e2e          # full HTTP flow
```

Integration tests run against a real database rather than a mocked Prisma,
because the failures that matter — CHECK constraints, unique indexes,
`FOR UPDATE` locking, transaction rollback — only exist there. Providers are
stubbed at the HTTP boundary with `nock`, so adapter serialisation, timeouts and
error mapping are exercised as in production. See
[ADR 011](docs/adr/011-test-strategy.md).

**The tests that must never be deleted**, each corresponding to a way the
platform could charge a customer twice or pay a provider twice:

| Test | Property |
|---|---|
| `checkout.concurrency` › concurrent submit | Exactly one order per quote |
| `payments.webhook` › replayed capture | Exactly one `order.paid` event |
| `wallet.concurrency` › concurrent debits | No over-spend |
| `provider-engine` › non-retryable error | Second provider is **not** called |
| `outbox` › rolled-back transaction | No event is claimable |
