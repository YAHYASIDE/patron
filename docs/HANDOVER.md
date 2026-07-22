# Patron — Project Handover Report

**Date:** 2026-07-22
**Branch:** `claude/patron-monorepo-setup-1o2gl7` (PR #1 → `main`)
**Latest commit:** `8fa4666`
**CI:** all 9 GitHub Actions checks green (run #19)

This report hands the project over in a state where every CI gate is green and a
new engineer can continue without additional context. It complements — and does
not replace — the existing [Developer Guide](./DEVELOPER_GUIDE.md), the
[ADRs](./adr/README.md), and the [Production Readiness report](./PRODUCTION_READINESS.md).

---

## 1. Executive summary

Patron is a **digital-products marketplace** — game top-ups, gift cards and
subscriptions — sold in multiple currencies (USD, EUR, MRU, XOF) and fulfilled
through pluggable upstream providers. It is a **Turborepo monorepo**:

- **`apps/api`** — the NestJS backend. Production-grade and the heart of the
  system: checkout, orders, payments, a wallet ledger, provider fulfilment,
  refunds, FX, reporting, and a hardened Identity & Access layer.
- **`apps/admin`** — a Next.js (App Router) dashboard. **Structural scaffold**;
  builds and lints clean, no business features yet.
- **`apps/mobile`** — a Flutter app. **Structural scaffold**; analyzes and tests
  clean, no business features yet.

**State at handover.** The backend is feature-complete for the core commerce
flow and is exercised end-to-end by integration and e2e suites. The most recent
work brought the whole repository to a **fully green CI pipeline**:

| Area | Before this phase | Now |
|---|---|---|
| Unit-test coverage (api) | 12.8% lines | **93.2% lines / 92.3% functions / 87.0% branches** |
| Unit tests (api) | 65 | **794** |
| `npm audit` advisories (api) | 51 (6 high) | **0** |
| GitHub Actions | multiple red jobs | **all 9 green** |

No business features were added in this phase; the work was tests, dependency
security, and CI/build correctness.

---

## 2. Architecture overview

```
                    ┌──────────────┐      ┌──────────────┐
   Flutter mobile ──┤              │      │              │
   (scaffold)       │  NestJS API  │──────│ PostgreSQL16 │
   Next.js admin  ──┤  apps/api    │      │  (Prisma)    │
   (scaffold)       │              │      └──────────────┘
                    │              │      ┌──────────────┐
                    │   BullMQ ────┼──────│  Redis 7     │
                    └──────┬───────┘      └──────────────┘
                           │ OTLP
                     ┌─────┴──────┐
                     │ OTel       │  traces → collector → backend
                     │ collector  │  metrics → /metrics (Prometheus)
                     └────────────┘
```

**Backend module map** (`apps/api/src/modules`): `auth`, `users`, `roles`,
`permissions`, `catalog`, `orders`, `payments`, `wallet`, `refunds`, `providers`,
`fx`, `notifications`, `reports`, `maintenance`, `queues`. Cross-cutting concerns
live in `apps/api/src/common`: `prisma`, `outbox`, `idempotency`, `crypto`,
`audit`, `locking`, `money`, `metrics`, `tracing`, `health`, `filters`, `guards`,
`context`, `reference`, `logging`.

**Load-bearing patterns** — each has an ADR under [`docs/adr`](./adr/README.md):

- **Transactional outbox** (ADR 003) — every side effect is written to
  `outbox_events` in the same DB transaction as the state change; a relay moves
  them onto BullMQ with at-least-once delivery, so every processor is idempotent.
- **Wallet as an append-only ledger** (ADR 005) — `wallets.balance` is a cached
  projection; `wallet_transactions` is the truth. Mutations take a row lock
  (`FOR UPDATE`) to prevent lost updates. `findDrift()` reconciles the two.
- **Idempotency keys** (ADR 004) on money-moving endpoints.
- **Provider Engine** (ADR 002) — strategy + registry; adapters (`fazercards`,
  `foxreload`, `base-http`) are pluggable, credentials are AES-256-GCM encrypted.
- **Derived order status** (ADR 006), **checkout quote price-lock** (ADR 001),
  **multi-currency with frozen FX** (ADR 007), **global lock ordering** (ADR
  010/013), **keyset pagination + rollups + retention** (ADR 017).

**Reading order for a new engineer** is documented in
[`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md#reading-order-for-a-new-engineer).

---

## 3. Features completed

### Hardened this project (explicitly scoped sprints)

- **Identity & Access (Sprint 1)** — see [`sprint1.md`](./sprint1.md):
  - Argon2id password hashing (`@node-rs/argon2`), backward-compatible bcrypt
    verify + transparent rehash-on-login.
  - JWT access/refresh with **refresh-token rotation** and family revocation on
    replay.
  - RBAC (users, roles, permissions) with a permissions guard.
  - Brute-force lockout (by identifier **or** IP) and per-endpoint rate limiting
    (throttler tiers).
  - Full audit logging of login/logout and sensitive actions.
  - Swagger documentation, unit tests.

### Implemented and test-covered (from the backend, exercised by integration/e2e)

The full commerce path works and is proven by the integration/e2e suites:

- **Catalog** — products, categories, games, pricing, provider mapping, stock
  across three delivery modes (code pool, auto-provider, manual).
- **Checkout & Orders** — quote with a 15-minute price lock, idempotent order
  creation, derived status, order-item fulfilment, code reveal through an
  audited endpoint.
- **Payments** — payment intents, Stripe and wallet gateways, capture, webhook
  ingestion with signature verification and de-duplication.
- **Wallet** — ledger, credit/debit, admin adjustment (audited), drift
  reconciliation.
- **Refunds** — full/partial, card vs. wallet, frozen-FX amounts.
- **Providers** — engine, adapters, health checks, key rotation.
- **FX** — rate recording, feed sync, staleness detection.
- **Notifications** — email/push/in-app channels, template rendering.
- **Reporting** — revenue/profit/product/provider/currency/refund/LTV/failure
  reports in raw SQL (base currency), CSV export.
- **Maintenance & queues** — outbox relay, fulfilment/notification/metrics
  processors, nightly rollups and retention.

> These modules are functional and covered, but only Identity & Access has had a
> dedicated hardening/review sprint. See §8 and §9.

### Not started (intentionally)

- `apps/admin` business features (dashboard is a scaffold).
- `apps/mobile` business features (app is a scaffold).

---

## 4. Database status

- **Engine:** PostgreSQL 16. **ORM:** Prisma 6 (`@prisma/client` 6.x).
- **Schema:** 40 models, 15 enums (`apps/api/prisma/schema.prisma`).
- **Migrations:** 15, applied cleanly by `prisma migrate deploy` (verified in
  CI). The `20260724000000_scale_hardening` migration plus 11 single-statement
  companions add operational objects Prisma's schema language cannot express —
  **BRIN**, **GIN trigram**, **partial** and **keyset** indexes, DB-side
  `gen_random_uuid()` id defaults, sequences, extended statistics and
  autovacuum tuning. `CREATE INDEX CONCURRENTLY` lives in its own
  single-statement migrations so Prisma does not wrap it in a transaction.
- **Drift gate:** the `api-drift` CI job asserts **no *structural* drift** (no
  table/column added, dropped, retyped or renamed) rather than byte-for-byte
  equivalence, because the operational layer above cannot live in
  `schema.prisma`. See **ADR 020**.
- **Reconciliation:** `deploy/scripts/reconcile.sql` and `WalletService.findDrift`
  detect ledger/projection divergence.
- **Data-layer decisions:** [`apps/api/DATABASE.md`](../apps/api/DATABASE.md) and
  ADRs 001, 005, 006, 007, 009, 012, 017.

---

## 5. Test coverage statistics

| Suite | Count | Runner | Notes |
|---|---|---|---|
| Unit | **794** (76 spec files) | Jest, mocked deps | Coverage gate below |
| Integration | **32** (5 spec files) | Jest + real Postgres | CHECK constraints, `FOR UPDATE`, outbox, drift |
| E2E | **27** (2 spec files) | Jest + real Postgres + app | register→quote→order→pay→fulfil→reveal |
| **Total** | **853** | | all green in CI |

**Unit coverage (gate: branches 70 / functions 80 / lines 80):**

```
Lines      93.17%  (2251/2416)
Functions  92.28%  (586/635)
Branches   86.87%  (715/823)
```

- Coverage is enforced by `jest --coverage` in the `api-unit` CI job; the
  thresholds live in `apps/api/test/jest-unit.json` and were **not** lowered.
- **Test infrastructure (ADR 021):** integration/e2e use a real Postgres. In CI
  they use the Postgres **service the job already provides** (`DATABASE_URL`
  exported at job level); a `testcontainers` container is a **local-only
  fallback**. Integration truncates per test; e2e deliberately shares state
  across ordered steps. The e2e harness neutralises the production rate-limiter
  and clears `login_attempts` between cases so auth/RBAC assertions are not
  masked by throttling — test-only overrides, production behaviour unchanged.
- **The tests that must never be deleted** are called out in
  [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md#the-tests-that-must-never-be-deleted)
  and ADR 011.

---

## 6. Security status

**`apps/api` — `npm audit --audit-level=moderate`: 0 advisories.** Cleared from
51 (6 high) this phase by upgrading two dependency trees:

- **OpenTelemetry** 0.57/1.30 → 0.221/2.10 (`sdk-node`, `resources`,
  `sdk-trace-base`, `exporter-trace-otlp-http`, `auto-instrumentations-node`,
  `semantic-conventions`). `resources@2` removed the `Resource` class, so
  `src/tracing.ts` now builds the resource with `resourceFromAttributes`. This
  also cleared the transitive `gaxios` advisory.
- **testcontainers** 10 → 12 (dev), clearing the high `undici`
  request-smuggling / decompression advisories plus `uuid`, `dockerode`.

**Application security posture** (see [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md)):

- Argon2id password hashing; AES-256-GCM for reversible secrets (provider keys,
  delivered codes); JWT rotation with replay revocation; RBAC; brute-force
  lockout; per-endpoint throttling; idempotency on money endpoints; full audit
  log; one error envelope with a correlation id (ADR 019).
- **CodeQL** clean — the report-export report selector was rewritten from
  dynamic dispatch to a static `switch` so a user-supplied report name can never
  select an unintended method.
- **CI security gates**, all green: `npm audit`, gitleaks secret scan, CodeQL,
  and a "no secret-shaped files tracked" check.
- **Container:** multi-stage, non-root (`patron:nodejs`), healthcheck,
  `dumb-init`; the npm CLI (with its own vulnerable transitive deps) is stripped
  from the runtime image (**ADR 021**); Trivy scans the built image for
  CRITICAL/HIGH.

**Known, out of `apps/api` scope:** `apps/admin` (Next.js) still reports a few
`next`/`postcss`/`sharp` advisories. The CI `security` job audits `apps/api`
only, so these do not block CI, but they should be triaged before the admin app
ships (see §8).

---

## 7. CI/CD status

**All 9 GitHub Actions checks green** on the head commit (run #19):

| Job | What it gates |
|---|---|
| API · lint & types | eslint (`--max-warnings=0`), `tsc --noEmit`, `prisma format --check` |
| API · unit tests | 794 tests + coverage thresholds |
| API · migration drift | structural drift between migrations and schema (ADR 020) |
| API · integration & e2e | 32 integration + 27 e2e against real Postgres/Redis |
| Admin · lint, types & build | Next.js lint/typecheck/build |
| Mobile · analyze & test | `flutter analyze` + `flutter test` |
| Security checks | `npm audit`, gitleaks, CodeQL, secret-file check |
| CodeQL | code-scanning alerts |
| Build API image | Docker build + Trivy scan (publish to ghcr on `main` only) |

- Workflow: `.github/workflows/ci.yml`. Triggers: `pull_request` and
  `push: [main]`. `concurrency` cancels superseded runs.
- **Docker build** context is the app directory (`apps/api`), so the image build
  uses a self-contained `apps/api/tsconfig.build.json` rather than the shared
  `packages/tsconfig` it cannot reach (**ADR 021**). The image is built with
  `load: true` and scanned locally by Trivy using a lowercased image reference;
  it is published to `ghcr.io` only on a push to `main`.
- **Deploy artefacts:** `deploy/k8s/*` (namespace/config, migration job, API and
  worker deployments, ingress + network policy), `deploy/docker-compose.prod.yml`,
  `deploy/nginx/nginx.conf`, `deploy/otel-collector.yaml`, `deploy/scripts/`
  (`backup.sh`, `reconcile.sql`). Topology is described in ADR 015 and
  [`OPERATIONS.md`](./OPERATIONS.md) / [`DISASTER_RECOVERY.md`](./DISASTER_RECOVERY.md).

---

## 8. Remaining technical debt

Ordered roughly by priority:

1. **Admin & mobile are scaffolds.** No business features; they only keep CI
   green. All customer/admin UX is still to build.
2. **Admin dependency advisories.** `apps/admin` reports `next`/`postcss`/`sharp`
   advisories. Triage before the admin app ships (the api security gate does not
   cover it).
3. **Domain modules lack dedicated hardening sprints.** Catalog, orders,
   payments, wallet, refunds, providers, fx, notifications and reporting are
   functional and covered, but only Identity & Access has had the Sprint-1
   treatment (threat review, edge cases, docs). Each deserves the same.
4. **`tsconfig.build.json` duplicates the shared compiler options.** It must be
   kept in sync with `packages/tsconfig` by hand (a comment says so). A cleaner
   long-term fix is to vendor or publish `@patron/tsconfig` so the isolated
   image build can resolve it (ADR 021 records the trade-off).
5. **Migration drift is structural-only.** `schema.prisma` is intentionally not
   byte-identical to the migrations (operational SQL objects). The gate catches
   dangerous drift, not index/default nuance (ADR 020) — understood and
   documented, but worth revisiting if the team later adopts a tool that can
   model those objects.
6. **E2E throttler/lockout are neutralised in tests.** A dedicated test for the
   rate-limiter and IP lockout behaviour would restore coverage of those paths
   that the e2e harness currently bypasses.
7. **Payment gateways are boundary-stubbed in tests.** Real Stripe integration
   (and any additional gateways) needs live sandbox testing before launch.
8. **Observability needs a real collector wired up** in staging/prod (endpoints
   exist; ADR 008/014, `OBSERVABILITY.md`).
9. **Node 20 deprecation warnings** in some GitHub Actions (`checkout`,
   `setup-node`, docker actions) — cosmetic today, upgrade when convenient.
10. **Pre-launch blockers** enumerated in
    [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md#blockers) (secrets
    management, real payment credentials, load testing, etc.) still stand.

---

## 9. Recommended roadmap for the next milestone

**Milestone goal: a demonstrable end-to-end product on a staging environment.**

1. **Sprint 2 — Catalog & Checkout hardening.** Give the catalog and
   checkout/orders modules the Sprint-1 treatment: threat review, input
   validation edge cases, admin CRUD, documentation, and any missing tests.
2. **Sprint 3 — Payments & Refunds, for real.** Wire a live Stripe sandbox,
   exercise webhooks end-to-end, verify wallet/refund flows against real
   captures, and add a dedicated throttler/lockout test suite.
3. **Sprint 4 — Admin dashboard MVP.** Build the first real admin screens (auth,
   catalog management, order lookup, refunds) on the Next.js scaffold; triage
   its dependency advisories as part of the sprint.
4. **Sprint 5 — Mobile MVP.** First customer flow (browse → checkout → wallet)
   on the Flutter scaffold.
5. **Cross-cutting, before/with the above:** stand up a **staging deployment**
   from `deploy/k8s`, wire the **OTel collector**, run a **load test** against
   the scale-hardening work (ADR 017), and finalise **secrets management**.

Each sprint should keep the CI pipeline green and update the relevant ADR/docs.

---

## 10. Lessons learned during implementation

- **Green gates hide the next failure.** Fixing coverage and security un-gated
  the previously-skipped `build` and `CodeQL` checks, which then failed for
  unrelated pre-existing reasons. Expect a gate you just fixed to reveal the
  next one; budget for it.
- **Read the log before classifying a failure.** The `migration drift` job was
  first assumed to be the `CREATE INDEX CONCURRENTLY` error; the log showed it
  was genuine schema-vs-migration divergence. The one-line diagnosis was wrong
  until the actual output was read.
- **An isolated Docker context can't reach a monorepo-shared config.** The image
  build failed with 811 decorator errors because `tsconfig.json` extended
  `../../packages/tsconfig`, which does not exist in the `apps/api` build
  context. A self-contained `tsconfig.build.json` fixed it (ADR 021).
- **CodeQL models `Map.get`.** Replacing object indexing with a `Map` did *not*
  clear the "unvalidated dynamic method call" alert; only a static `switch`
  (no dynamic dispatch at all) did.
- **Container image references must be lowercase**, and a PR build that never
  pushes must `load` the image for a scanner to see it.
- **Production images should not ship npm.** The only Trivy findings were in the
  npm CLI bundled in the base image — not the app. Stripping npm from the
  runtime both cleared them and hardened the image.
- **Prefer the ambient CI database over nested testcontainers.** Spinning a
  container inside the CI runner (which already provides Postgres) caused
  intermittent `write EPIPE` failures; using the provided service DB removed the
  flakiness and ran ~4× faster.
- **`CREATE INDEX CONCURRENTLY` needs single-statement migrations.** Prisma wraps
  multi-statement migrations in a transaction; Postgres forbids `CONCURRENTLY`
  inside one. One statement per migration runs without a transaction.
- **Parallel sub-agents scale mechanical test authoring** — 76 spec files were
  produced by fanning module groups out to independent agents, each validating
  only its own files, then verifying the full suite centrally.

---

*This document is a point-in-time handover. Keep it, the ADRs, and
`IMPLEMENTATION_STATUS.md` current as the project evolves.*
