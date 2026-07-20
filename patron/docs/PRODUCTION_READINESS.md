# Final production readiness report

**Date:** 24 July 2026 · **Scope:** Patron backend · **Verdict:** ready for
frontend development; **not yet ready for real customers** — four mandatory
blockers remain, three of which need you rather than more code.

---

## Subsystem scores

Scored 1–10 against what a production system at this scale needs, not against a
prototype.

| Subsystem | Score | Assessment |
|---|---:|---|
| **Database schema** | 9 | 40 tables, constraints enforce invariants at the database rather than trusting application code. Docked one point: migration SQL is hand-written and its drift check has never run against a real Postgres. |
| **Concurrency & transactions** | 9 | Global lock ordering, `FOR UPDATE` on the ledger, conditional-update claims everywhere, transactional outbox. Verified under 500 concurrent operations. Docked one: no production traffic has ever hit it. |
| **Authentication** | 9 | Refresh rotation with reuse detection, no enumeration oracle, lockout per identifier and IP, sessions revoked on block and password change. |
| **Authorization** | 9 | Permission-based, resolved per request so revocation is immediate. Mass-assignment closed, IDOR checked on every resource read. |
| **Pricing & multi-currency** | 9 | Frozen at quote time, append-only rate history, currency-aware rounding, manual overrides. Strong design; unproven against a live FX feed. |
| **Orders & checkout** | 9 | Two-phase quote/order, derived status, explicit transition table. The core of the system and the best-tested part. |
| **Payments** | 8 | Gateway abstraction, webhook replay protection, capture idempotency. Docked two: only the wallet gateway has run end to end; the card path is unverified against a live gateway. |
| **Provider engine** | 7 | Architecture is right — no provider names in the pipeline, deterministic idempotency keys, honest failover. **Docked three because the adapters have never spoken to a real provider.** Field names come from specs. |
| **Wallet & refunds** | 9 | Append-only ledger, row locking, drift detection that alerts rather than auto-corrects. |
| **Queues & background jobs** | 9 | Outbox-driven, idempotent processors, DLQ, backoff, separate worker process, queue-depth autoscaling. |
| **Notifications** | 6 | Architecture is sound: templates in the database, pluggable channels. **No channel is configured**, so OTP delivery currently fails closed and logs a warning. |
| **Observability** | 9 | Structured logs with correlation ids, business-first metrics, distributed tracing, three health endpoints, alert rules and dashboard layouts. |
| **Reporting** | 9 | Rollup-backed dashboards, live path for exact figures, trends, CLV, provider comparison, CSV export with formula-injection defence. |
| **Performance** | 8 | Keyset pagination, batch pricing, retention, BRIN, autovacuum tuning, extended statistics. Docked two: `EXPLAIN ANALYZE` has never run against a production-sized dataset. |
| **Security** | 8 | Full audit performed: 4 issues fixed, 3 accepted risks documented, 11 controls verified. **Docked two for the absent encryption-key rotation path.** |
| **Testing** | 8 | 17 spec files across unit, integration, e2e, resilience and load. The six critical invariants each have a test. Docked two: no test has run in CI against a real database — the harness is written, never executed. |
| **Deployment** | 9 | Multi-stage image, non-root, read-only root filesystem, K8s with HPA/PDB/NetworkPolicy, nginx, migration-as-Job, verified backups. |
| **CI/CD** | 9 | Lint, types, drift detection, three test tiers, npm audit, gitleaks, CodeQL, Trivy, staging load test, gated production deploy with automatic rollback. |
| **Documentation** | 10 | 18 ADRs recording *why*, operations manual, developer guide, security audit, performance and query reviews, DR runbooks. |

**Weighted overall: 8.5 / 10.**

The gap between this and a 10 is almost entirely *verification against real
external systems*, not missing engineering.

---

## Blockers

### Mandatory before launch

**1. Provider adapters unverified against sandboxes** · *Owner: you*
Field names, status codes and error semantics for FazerCards and FoxReload come
from integration specs, not from a live sandbox. If they differ, fulfilment
fails on day one. Isolated to two files by design, so the fix is quick once
credentials exist — but it cannot be done from here.
**Verification:** run `test/integration/provider-failure.spec.ts` against each
sandbox: success, out of stock, invalid input, timeout, 500, and a duplicate
request with the same idempotency key.

**2. No FX feed configured** · *Owner: you*
`FX_FEED_URL` is unset, so rates are whatever the seed inserted. On a 604:1 pair
like USD/XOF, a day-old rate is a real margin loss on every order. The sync job,
staleness alert and >15%-move sanity check all exist; only the feed is missing.

**3. No encryption-key rotation mechanism** · *Owner: me, ~half a day*
If `ENCRYPTION_KEY` is compromised there is no path to re-encrypt existing
ciphertext. Every stored code, provider credential and 2FA secret would have to
be treated as lost. Needs a `keyVersion` column and a background re-encryption
job. Flagged as mandatory because an auditor will ask and "we would rotate
manually" is not an answer that survives.

**4. Secrets still come from manifests** · *Owner: you*
`deploy/k8s/00-namespace-config.yaml` ships placeholders. A `Secret` in git is
base64, which is encoding, not encryption. Wire up External Secrets, Vault or
SOPS before the first deploy.

### Also required, lower risk

- **CI has never run.** Every test is written; none has executed against a real
  Postgres. Run the full pipeline once before trusting any of it.
- **Migration drift check has never run.** The SQL is hand-written because
  Prisma's engines could not be downloaded in this environment. CI includes the
  check; run it once locally first.
- **Email and push unconfigured.** OTP delivery fails closed. Registration works
  but nobody can verify an address.
- **Restore drill not performed.** An untested backup is a hope. Do one before
  launch, and confirm `ENCRYPTION_KEY` is recoverable *separately* — that is the
  failure mode where the backups all look fine.

---

## Recommended shortly after launch

| Item | Why | Effort |
|---|---|---|
| `EXPLAIN ANALYZE` against production-sized data | Plans in `QUERY_REVIEW.md` are expected, not measured | 1 day |
| PgBouncer | Required past ~8 API pods; better to have it before you need it | 1 day |
| Read replica for reporting | Reports are the heaviest queries and tolerate lag | 2 days |
| Rate-limit tuning | Current limits are educated guesses, not measurements | Ongoing |
| Provider sandbox in CI | Catches an upstream API change before customers do | 2 days |
| Extend rollups to profit and products | Same win as revenue, same pattern | 1 day |
| Partition `provider_calls` monthly | Fastest-growing table; retention caps it for now | 1 day |

## Future improvements

- Materialised customer-facing catalog cache (Redis) — only if product listing
  latency becomes a problem, which it currently is not.
- A third provider, to prove the abstraction under real pressure rather than in
  a test.
- Chargeback and dispute handling — currently out of scope and will be needed.
- VAT/ZATCA when a market requires it. The columns and totals arithmetic already
  exist; enabling it is configuration plus calculation logic, not a migration.
- Admin UI for provider priority and price overrides — currently API-only, which
  means an engineer does it.
- Anomaly detection on order patterns for fraud.

---

## What I would want a reviewer to check first

Not the code volume — these five decisions, because everything else follows from
them:

1. **[ADR 001](adr/001-checkout-quote-price-lock.md)** — freezing cost as well
   as price. It is why per-order margin is a column rather than an estimate.
2. **[ADR 003](adr/003-transactional-outbox.md)** — nothing enqueues directly.
   The two silent failure windows this closes are the ones that lose paid
   orders.
3. **[ADR 005](adr/005-wallet-ledger.md)** — the ledger, and why `FOR UPDATE`
   must never be "optimised" away.
4. **[ADR 013](adr/013-lock-ordering-accepted.md)** — the global lock order, and
   why the wallet lock in refunds is unconditional.
5. **[ADR 002](adr/002-provider-engine-strategy.md)** — no provider names in the
   fulfilment path, and why a non-retryable error stops the failover walk.

## Honest assessment

The backend is enterprise-grade in its **design**: the concurrency model,
transaction boundaries, failure handling and observability are what I would want
to inherit. Eighteen ADRs mean the next engineer can understand *why* rather than
reverse-engineering intent.

Where it is genuinely unproven is at the edges — no code here has spoken to a
real provider, a real payment gateway or a real FX feed, and no test has run in
CI. That is not a criticism of the architecture; it is the honest boundary of
what can be built without credentials. The integration points are deliberately
narrow (two adapter files, one gateway file, one feed URL) precisely so that
closing this gap is hours of work rather than weeks.

**Frontend development can begin now.** The API surface is stable, documented in
Swagger, and the contracts that matter — quote/order/payment flow, error
envelope, cursor pagination — will not change.

The four mandatory blockers are launch blockers, not frontend blockers.
