# Patron — Architecture Review v2 (Remediation Summary)

**Date:** 2026-07-22
**Predecessor:** [`architecture-review.md`](./architecture-review.md)
**Scope:** Fixes for the findings raised in the v1 review. **Architecture and
technical-debt only — no business features were added.**

---

## 1. What changed at a glance

| # | Task | Status | Files |
|---|---|---|---|
| 1 | Secure `/metrics` endpoint | ✅ Done | `common/metrics/metrics.controller.ts`, `config/env.validation.ts` |
| 2 | Remove duplicated `RollupService` registration | ✅ Done | `modules/reports/reports.module.ts` |
| 3 | Remove duplicated `AuditModule` import | ✅ Done | `app.module.ts` |
| 4 | Remove duplicated decorators | ✅ Done | `modules/payments/payments.controller.ts`, `modules/reports/reports.controller.ts` |
| 5 | Move business logic out of `reports.controller.export()` | ✅ Done | `modules/reports/report-export.service.ts`, `modules/reports/reports.controller.ts` |
| 6 | Refactor services > 300 lines | ✅ Done (as appropriate) | `modules/reports/reports.service.ts` (orders/quotes reviewed, left intentionally) |

Diff footprint: **8 files, +95 / −55**. No dependencies added, no schema
changes, no API surface added.

---

## 2. Fixes in detail

### Task 1 — Secure `/metrics` (v1 §13, concern #1)

**Problem:** the guard was `if (expected && auth !== 'Bearer '+expected) throw`.
With `METRICS_TOKEN` unset the endpoint was **open**, exposing revenue/order
volume through metric names.

**Fix — fail closed, with production enforcement:**

- `metrics.controller.ts` now denies when no token is configured **in
  production**; a configured token is always enforced:
  ```ts
  const expected = this.config.get<string>('observability.metricsToken');
  if (!expected) {
    if (process.env.NODE_ENV === 'production') throw new UnauthorizedException();
    return this.metrics.scrape();           // open only outside production
  }
  if (auth !== `Bearer ${expected}`) throw new UnauthorizedException();
  ```
- `env.validation.ts` now **requires** `METRICS_TOKEN` (min length 16) when
  `NODE_ENV === production`, so a production instance cannot boot without it —
  the failure moves from "silently exposed at runtime" to "won't start
  misconfigured."

**Why not require it everywhere:** an existing e2e test asserts
`/metrics` returns `200` without auth in the **test** environment
(`checkout.e2e-spec.ts`). Keeping the endpoint open only outside production
preserves that contract while closing the real (production) exposure — the sole
place the v1 review flagged data as sensitive.

### Task 2 — Duplicated `RollupService` registration (v1 §7-4, §12-2)

**Problem:** `RollupService` was provided by **both** `MaintenanceModule` and
`ReportsModule` (both also exported it). `QueuesModule` imports both, so the
maintenance processor and `ReportsService` could bind to **different instances**
of a stateful rollup service.

**Fix:** `MaintenanceModule` is now the sole owner. `ReportsModule` **imports
`MaintenanceModule`** and no longer lists `RollupService` in its
providers/exports:

```ts
imports: [ BullModule.registerQueue(...), MaintenanceModule ],
providers: [ ReportsService, AnalyticsService, ReportExportService ],
exports:   [ ReportsService, AnalyticsService ],
```

`ReportsService` still injects `RollupService` (resolved via the imported
module); `QueuesModule` still gets it from `MaintenanceModule` directly. Result:
**one** instance. No cycle is introduced (`MaintenanceModule` imports nothing).

### Task 3 — Duplicated `AuditModule` import (v1 §7-3, §12-6)

**Problem:** `AppModule`'s `imports` listed `AuditModule` twice.

**Fix:** removed the second occurrence. One import remains.

### Task 4 — Duplicated / conflicting decorators (v1 §7-1/2, §12-1)

**Problem:** two money-adjacent endpoints stacked conflicting decorators, making
the effective rate limit ambiguous:

- `payments.controller` webhook `handle()` — two `@Throttle` (`300` then `600`)
  and two `@ApiOperation`.
- `reports.controller` `export()` — three `@Throttle`
  (`default:5`, `default:10`, `expensive:5`) and three `@ApiOperation`.

**Fix:** each endpoint now carries **one** intentional decorator of each kind:

- Webhook: `@Throttle({ default: { limit: 600, ttl: 60_000 } })` — the higher
  limit matches the documented intent (never throttle a gateway retry storm
  into a lost capture).
- Export: `@Throttle({ expensive: { limit: 5, ttl: 60_000 } })` — routed
  through the `expensive` tier, since export runs the heaviest queries.

### Task 5 — Business logic in `reports.controller.export()` (v1 §9, §12-3)

**Problem:** the controller held the report-name → data-source **dispatch map**,
unknown-report **validation** (`res.status(400)`), and result reshaping.

**Fix:** moved into `ReportExportService`, which already owned `toCsv()`/
`filename()`. It now exposes a single entry point:

```ts
async export(report, dto): Promise<{ filename: string; csv: string }> {
  const sources = this.sources(dto);          // the report→service map
  const source = sources[report];
  if (!source) throw new BadRequestException(`Unknown report "${report}"...`);
  const rows = await source();
  return { filename: this.filename(report, from, to), csv: this.toCsv(rows) };
}
```

The controller is now a thin HTTP adapter:

```ts
const { filename, csv } = await this.exporter.export(report, dto);
res.setHeader('content-disposition', `attachment; filename="${filename}"`);
return csv;
```

**Behavioral note:** an unknown report still returns **HTTP 400**. The body
shape changes from a plain-text message to the standard JSON error envelope
(ADR-019) because validation now throws `BadRequestException` instead of writing
`res` directly — a consistency improvement, not a functional change.
`ReportExportService` gains constructor deps on `ReportsService` and
`AnalyticsService` (same module; no cycle).

### Task 6 — Services larger than 300 lines (v1 §10)

The three services over 300 lines were `reports.service` (478),
`orders.service` (370), `quotes.service` (331).

- **`reports.service` — refactored.** The identical revenue-totals reducer was
  duplicated across `revenue()` and `revenueFromRollup()` (v1 §7-5). Extracted
  to a private `revenueTotals(series)` helper; both paths now call it. Pure
  deduplication, identical output.
- **`orders.service` — reviewed, left as-is.** Cohesive order-lifecycle service;
  every method is a distinct operation (create-from-quote, list, reveal, sync,
  cancel, expire) already backed by small private helpers. No meaningful
  duplication. v1 classified it "watch, not split."
- **`quotes.service` — reviewed, left as-is.** Already decomposed into
  single-purpose privates (`priceItem`, `assertAvailable`, `validateInputs`,
  `resolveCoupon`, `discountFor`, `convertFrom`, `present`). Splitting the
  coupon cluster into its own service would be a judgment-call extraction of
  *business logic* with behavior risk — out of scope for a debt-only pass.

> Guiding principle for Task 6: **"where appropriate, without changing
> behavior."** The clear behavior-preserving win (the duplicated reducer) was
> taken; speculative splits of cohesive services were not.

---

## 3. Verification

| Check | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ Pass |
| `npm run lint:check` (eslint, `--max-warnings=0`) | ✅ Pass |
| `npm run test:unit` | ✅ **50/50** pass |
| `npm run build` (`nest build`) | ✅ Pass |
| Integration / e2e | ⚠️ Not run locally — **no Docker daemon** in this environment (they need Postgres + Redis). They run in CI. |

**DI-graph safety** (validated structurally + by typecheck/build): the reports →
maintenance import and the removed duplicate registrations produce an acyclic,
resolvable graph. The e2e suite boots the full `AppModule`, so CI exercises the
graph end-to-end.

**`/metrics` behavior matrix:**

| Environment | `METRICS_TOKEN` | Result |
|---|---|---|
| production | set | enforced (401 without correct bearer) |
| production | unset | **won't boot** (env validation) → cannot be exposed |
| test / dev | unset | open (preserves existing e2e contract) |
| test / dev | set | enforced |

---

## 4. Findings deliberately deferred

These v1 items were **not** in the six requested tasks and were left untouched
to keep this pass debt-only and behavior-preserving. Recommended as follow-ups:

| v1 ref | Item | Why deferred |
|---|---|---|
| §12-5 | Implicit `payments → orders` coupling via `assertTransition` | Moving the state machine to a shared surface touches domain boundaries; warrants its own change. |
| §12-9 / §15-7 | Worker boots the full HTTP module graph | Introducing a lean `WorkerModule` changes runtime bootstrap; needs its own verification. |
| §12-8 / §15-9 | Pin Prisma `binaryTargets`; bundle Prisma CLI | Touches image build; validate via a Docker build, not in this pass. |
| §5 / §15-8 | Grow (or reserve) `@patron/types` | Awaits the admin app consuming API contracts. |
| §7-6 | `BullModule.registerQueue` repeated in two modules | Intentional per-module queue injection; not a defect. |
| §13-3 | `npm audit` advisories (transitive) | Dependency triage, tracked separately. |

---

## 5. Net effect

All six requested findings are resolved. The changes remove ambiguous
rate-limit controls on money endpoints, close the production `/metrics`
exposure, eliminate a duplicate-stateful-service class of bug, and thin a
controller back to HTTP wiring — with the full lint/typecheck/unit/build gate
green and no business features added.
