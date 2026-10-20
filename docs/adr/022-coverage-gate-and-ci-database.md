# ADR 022 — 80% coverage gate and the CI-provided test database

**Status:** Accepted · **Date:** 2026-07-22

## Context

This ADR records two test-infrastructure decisions taken while raising the
backend to a green CI pipeline. It extends — does not supersede — ADR 011 (the
three-tier real-database test strategy).

Unit coverage had drifted to ~13% of lines while a `jest --coverage` threshold
of branches 70 / functions 80 / lines 80 sat in `jest-unit.json`, so the
`api-unit` job failed on every run. Separately, the integration/e2e suites span
a `testcontainers` Postgres *per spec file*, which — inside the CI runner, which
**already provides** a Postgres service — duplicated the database, strained the
runner, and caused intermittent `write EPIPE` failures.

## Decision

- **Coverage:** meet the existing threshold rather than lower it. 76 unit spec
  files were added (12.8% → 93.2% lines; 65 → 794 tests), instantiating each
  class directly with `jest.fn()` mocks per the established convention. The
  thresholds in `jest-unit.json` are unchanged.
- **Test database:** integration/e2e use the Postgres the CI job **already
  provides** (`DATABASE_URL` exported at job level, migrated once); a
  `testcontainers` container is a **local-only fallback** when no `DATABASE_URL`
  is set. Integration truncates every table per test; e2e deliberately shares
  state across ordered steps (register → … → reveal) and is not truncated.
- **E2E harness overrides (test-only):** the e2e module overrides the injected
  `ThrottlerStorage` and clears `login_attempts` between cases so the production
  rate-limiter and IP-based lockout do not mask the auth/RBAC behaviour under
  test. Production behaviour is unchanged; the provider credential is encrypted
  at runtime with the app's own `CryptoService` rather than a fixed ciphertext.

## Consequences

- The coverage gate is real and green; regressions in covered code now fail CI.
- Integration/e2e run ~4× faster in CI and without the EPIPE flakiness.
- The e2e suite no longer exercises the throttler/lockout paths directly — a
  dedicated test for those should be added (tracked in `HANDOVER.md` §8).
- Local development still gets a real database with zero setup via the
  testcontainers fallback, provided a Docker daemon is available.
