# Implementation Status

Point-in-time snapshot of what is built, tested, and hardened, so a new engineer
can see where to pick up. Keep this current as the project evolves. See also the
[Handover report](./HANDOVER.md) and the [ADRs](./adr/README.md).

**Legend**

- ✅ **Done** — implemented, tested, and reviewed/hardened.
- 🟩 **Functional** — implemented and covered by tests; no dedicated hardening
  sprint yet.
- 🟨 **Scaffold** — structure only; builds/lints clean; no business logic.
- ⬜ **Not started.**

_Last updated: 2026-07-22 · commit `8fa4666` · CI: all 9 checks green._

---

## Apps

| App | Status | Notes |
|---|---|---|
| `apps/api` (NestJS) | 🟩 / ✅ | Core commerce complete; Identity & Access hardened (Sprint 1). |
| `apps/admin` (Next.js) | 🟨 | Scaffold — lint/typecheck/build green, no features. Has open dependency advisories to triage. |
| `apps/mobile` (Flutter) | 🟨 | Scaffold — `flutter analyze` + `flutter test` green, no features. |
| `packages/tsconfig` | ✅ | Shared TS base configs (`base`, `nestjs`, `nextjs`). |
| `packages/types` | ✅ | Shared framework-agnostic type contracts. |

## Backend modules (`apps/api/src/modules`)

| Module | Status | Notes / ADR |
|---|---|---|
| `auth` | ✅ | Argon2id, JWT + refresh rotation, lockout, throttling, audit (Sprint 1). |
| `users` / `roles` / `permissions` | ✅ | RBAC; system-role protections; self-action guards. |
| `catalog` | 🟩 | Products, categories, games, pricing, provider mapping, stock (3 delivery modes). |
| `orders` | 🟩 | Quote price-lock (ADR 001), idempotent create (ADR 004), derived status (ADR 006), reveal via audited endpoint. |
| `payments` | 🟩 | Intents; Stripe + wallet gateways; capture; webhook verify + de-dupe. Gateways HTTP-stubbed in tests. |
| `wallet` | 🟩 | Ledger + row locking (ADR 005); admin adjust (audited); drift reconciliation. |
| `refunds` | 🟩 | Full/partial; card vs. wallet; frozen-FX amounts. |
| `providers` | 🟩 | Engine + registry (ADR 002); adapters (fazercards, foxreload, base-http); health checks; key rotation. |
| `fx` | 🟩 | Rate recording, feed sync, staleness detection (ADR 007). |
| `notifications` | 🟩 | Email / push / in-app channels; template rendering. |
| `reports` | 🟩 | Raw-SQL reports in base currency (ADR 009); CSV export (ADR 016). |
| `maintenance` | 🟩 | Nightly rollups; retention pruning (ADR 017). |
| `queues` | 🟩 | Outbox relay (ADR 003); fulfilment/notification/metrics processors. |

## Cross-cutting (`apps/api/src/common`)

| Concern | Status | Notes / ADR |
|---|---|---|
| `outbox` | ✅ | Transactional outbox, SKIP LOCKED claim (ADR 003). |
| `idempotency` | ✅ | Interceptor + decorator on money endpoints (ADR 004). |
| `crypto` | ✅ | Argon2id, AES-256-GCM, bcrypt legacy verify. |
| `locking` | ✅ | Global lock ordering (ADR 010/013). |
| `money` | ✅ | Decimal money helpers. |
| `audit` | ✅ | Structured audit log with redaction. |
| `metrics` | ✅ | Prometheus registry + interceptor; `/metrics` secured. |
| `tracing` | ✅ | OpenTelemetry (SDK 2.x); ALS correlation (ADR 008/014). |
| `filters` / `context` | ✅ | One error envelope + correlation id (ADR 019). |
| `health` | ✅ | Liveness/readiness/full indicators. |
| `reference` | ✅ | Sequence-based order/quote/refund numbers. |

## Database

| Item | Status |
|---|---|
| Prisma schema (40 models, 15 enums) | ✅ |
| Migrations (15) apply cleanly | ✅ |
| Scale-hardening indexes (BRIN/GIN/partial/keyset) | ✅ (raw SQL; ADR 017) |
| Structural drift gate | ✅ (ADR 020) |
| Reconciliation script | ✅ (`deploy/scripts/reconcile.sql`) |

## Tests

| Suite | Count | Status |
|---|---|---|
| Unit | 794 | ✅ 93.2% lines / 92.3% functions / 87.0% branches |
| Integration | 32 | ✅ real Postgres |
| E2E | 27 | ✅ full checkout→pay→fulfil→reveal |

## CI/CD & Ops

| Item | Status |
|---|---|
| GitHub Actions (9 checks) | ✅ all green |
| Docker image build + Trivy scan | ✅ (npm-free non-root runtime; ADR 021) |
| Kubernetes manifests (`deploy/k8s`) | 🟩 present; not yet exercised on a live cluster |
| Prod compose / nginx / OTel collector | 🟩 present; wire up in staging |
| Secrets management | ⬜ pre-launch blocker (see PRODUCTION_READINESS) |

## Not started

- Admin dashboard features ⬜
- Mobile app features ⬜
- Live payment-gateway integration ⬜
- Staging/production deployment ⬜
- Load/performance testing of scale-hardening ⬜
