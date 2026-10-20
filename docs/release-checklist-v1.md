# Release Checklist v1 — Pre-Sprint-2 Verification

**Date:** 2026-07-22
**Branch:** `claude/patron-monorepo-setup-1o2gl7`
**HEAD:** `116dbdc` (Sprint 1: harden Identity & Access layer)
**Nature:** Read-only verification. No code was modified.

> **Bottom line — DO NOT treat this branch as "CI-green."**
> The five requested checks **cannot be confirmed green**, because **GitHub
> Actions has never run against this branch.** CI only triggers on pull requests
> and on pushes to `main`; every commit of the monorepo restructure, the three
> reviews, and Sprint 1 lives on a feature branch with **no open PR**, so no
> workflow has ever evaluated this code. Local sandbox checks pass, but a
> sandbox is not CI, and Docker/integration/e2e can't run here at all.

---

## Verdict summary

| # | Requested check | Result | Basis |
|---|---|---|---|
| 1 | GitHub Actions all green | ❌ **Not met** | **0 workflow runs** exist for this branch; the only runs (on `main`, old commits) are all **failing**. |
| 2 | CI integration tests pass | ❓ **Unverified** | The integration job has **never run** on this branch. |
| 3 | E2E tests pass | ❓ **Unverified** | Same job; never run on this branch. |
| 4 | Docker image builds | ❓ **Unverified** | The image job never ran; Docker can't run in the authoring sandbox either. |
| 5 | No new security warnings | ⚠️ **Partial** | No advisory is attributable to Sprint 1's change, but pre-existing moderate/high `npm audit` advisories remain and **would fail** the CI `security` gate. |

**Overall: NOT verifiable as release-ready.** The blocker is process, not (as far as local evidence shows) code: nothing has triggered CI.

---

## 1. Why there are no CI results for this branch

`/.github/workflows/ci.yml` triggers on:

```yaml
on:
  pull_request:
  push:
    branches: [main]
```

This branch is **not** `main` and has **no pull request**, so:

- Pushing Sprint 1 (and everything before it) triggered **nothing**.
- `list_workflow_runs(branch=claude/patron-monorepo-setup-1o2gl7)` → **`total_count: 0`**.
- `list_pull_requests(head=…setup-1o2gl7)` → **`[]`** (no PR, open or closed).

**Consequence:** none of the following have ever been exercised by CI on this
code — API lint, migration drift, unit, integration, e2e, admin build, mobile
analyze, security scan, or the Docker image build.

## 2. The only CI runs that exist (all on `main`, all failing)

Nine runs total, all on `main` at pre-restructure commits (the newest is
`bb49c98`, the repo state at the start of this work). They use the **old,
flat-layout `ci.yml`** and **old code** — they are **not representative of this
branch**. The most recent (`bb49c98`, run `29786935989`) broke down as:

| Job | Conclusion | Failing step |
|---|---|---|
| Lint & types | ✅ success | — |
| Unit tests | ❌ failure | `npm run test:unit` |
| Migration drift | ❌ failure | migrations vs schema mismatch |
| Integration & e2e | ❌ failure | `prisma migrate deploy` (integration/e2e then **skipped**) |
| Security checks | ❌ failure | `npm audit` (moderate+); secret-scan/CodeQL **skipped** |
| Build image | ⏭️ skipped | gated behind lint+unit+drift |

> These failures are on the **old main**, not this branch. They are listed only
> to show that `main` itself is currently red and that the last integration/e2e
> and image-build jobs never reached a pass/fail on their actual test steps.

## 3. Local sandbox evidence (current commit `116dbdc`)

Run in the authoring sandbox — **informative, but NOT a substitute for CI**
(different environment, no service containers):

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint:check` (`--max-warnings=0`) | ✅ pass |
| Unit tests | `npm run test:unit` | ✅ **65/65** (9 suites) |
| Build (compile) | `npm run build` (`nest build`) | ✅ pass |
| Integration | `npm run test:integration` | ⛔ **cannot run** — needs Postgres+Redis via testcontainers (**no Docker daemon**) |
| E2E | `npm run test:e2e` | ⛔ **cannot run** — same reason |
| Docker image | `docker build apps/api` | ⛔ **cannot run** — no Docker daemon |

So checks 2, 3, and 4 are **unverifiable anywhere available right now** — not in
CI (never triggered) and not locally (no Docker).

## 4. Security warnings (check 5)

`npm audit` on `apps/api` at `116dbdc` (read-only):

- **All deps:** 51 advisories (45 moderate, 6 high).
- **Production deps only:** 47 advisories (42 moderate, 5 high).
- Sources are **pre-existing transitive** packages — `@opentelemetry/*`,
  `uuid` (`<11.1.1`, via `gaxios`), etc. **No advisory is attributable to the
  Sprint 1 change** (`@node-rs/argon2` ships prebuilt binaries and does not
  appear in the advisory set).
- For context, earlier snapshots during this work reported ~54 advisories
  (46 moderate, 8 high); the current count is **not higher**, so Sprint 1 did
  not *introduce* new warnings.

**However:** the CI `security` job runs `npm audit --audit-level=moderate`,
which **fails** on these moderate+ advisories. So while nothing *new* appeared,
the security gate would be **red** on first run until the transitive advisories
are triaged/upgraded. Secret-scan (gitleaks), CodeQL, and the "no secret-shaped
files tracked" check have **not** been evaluated for this branch.

## 5. What it would take to actually verify

To turn the ❓/⚠️ rows into real pass/fail, CI must run against this branch.
The available trigger is **opening a pull request** from
`claude/patron-monorepo-setup-1o2gl7` (the config runs the full matrix on
`pull_request`). That would execute API lint/drift/unit/**integration**/**e2e**,
admin build, mobile, **security**, and the **Docker image build + Trivy scan**.

> This was **not** done here: the task is read-only and did not ask for a PR,
> and opening one is an outward-facing action. Recommend opening a PR (or having
> a maintainer dispatch CI) as the first step of Sprint 2's entry criteria.

### Expected risk areas once CI runs (predictions, not results)

- **`api-drift`** — should pass: no schema/migration changes were made after the
  existing migrations; but this has never been confirmed on the new per-app
  `ci.yml`.
- **`security`** — expected **red** at `npm audit --audit-level=moderate` due to
  the pre-existing transitive advisories above.
- **`build` (image)** — Argon2 was chosen specifically for Alpine
  (`@node-rs/argon2` musl prebuild is present in the lockfile), but the
  multi-stage image build has **never been executed**.
- **`api-integration`** (integration + e2e) — expected green based on local unit
  coverage and code review, but **unproven** without service containers.

---

## Checklist (as requested)

- [ ] **GitHub Actions all green** — ❌ cannot confirm; **no runs exist for this branch**.
- [ ] **CI integration tests pass** — ❓ never executed on this branch.
- [ ] **E2E tests pass** — ❓ never executed on this branch.
- [ ] **Docker image builds** — ❓ never executed; not runnable locally.
- [ ] **No new security warnings** — ⚠️ none *new* from Sprint 1, but pre-existing moderate/high advisories remain and would fail the `security` gate.

**Recommendation:** do **not** enter Sprint 2 under the assumption that CI is
green. Open a PR to trigger the full pipeline, then re-verify against real run
results and triage the `npm audit` advisories (and any drift/e2e/image findings)
before proceeding.

---

### Appendix — evidence

- Branch runs: `list_workflow_runs(branch=claude/patron-monorepo-setup-1o2gl7)` → `total_count: 0`.
- PRs: `list_pull_requests(head=yahyaside:claude/patron-monorepo-setup-1o2gl7, state=all)` → `[]`.
- Newest overall run: `main` @ `bb49c98`, workflow **CI**, conclusion **failure** (run `29786935989`).
- Local: `lint:check` pass · `test:unit` 65/65 · `nest build` pass · Docker daemon absent.
- `npm audit` (apps/api): 51 total (45 moderate, 6 high); 47 prod (42 moderate, 5 high).

*No code, workflows, or configuration were modified in producing this report.*
