---
name: patron-auto-fixer
description: >-
  Fix Patron bugs safely: reproduce with a failing test first, make the smallest
  change, prove it with the test and the full gates, commit per app. Use for "fix",
  "إصلاح", a failing CI check, an audit finding, or a bug the owner reports. Not for
  new features or redesigns.
---

# Patron auto-fixer

A fix is done when a test that failed before passes now, nothing else broke, and the
commit explains why.

## Procedure
1. **Reproduce**: write the smallest failing test in the right suite —
   `apps/api/test/unit` (logic), `test/integration` (real Postgres: locks, uniques,
   CHECK constraints, transactions), `test/e2e` (HTTP), `tests/live/*.mjs` (browser).
   Run it and see it fail for the reason you expect.
2. **Fix** the root cause in the code the bug lives in. Keep the diff minimal; match the
   surrounding style and comment density (CLAUDE.md §2).
3. **Money/security code** (payments, wallet, refunds, orders, auth, USDT, commissions):
   load patron-payment-guardian / patron-security and follow their invariants. Never weaken
   a lock, an idempotency key, a permission or a validation to make a test pass.
4. **Gates** (all must pass):
   - API: `npx tsc --noEmit -p tsconfig.json`, `npx eslint "{src,test}/**/*.ts" --max-warnings 0`,
     `npx jest --config test/jest-unit.json`, integration + e2e on a throwaway DB.
   - Admin/store: `npx tsc --noEmit -p tsconfig.json`, `npm run lint:check`.
   - Schema touched: `npx prisma format`, a new hand-written additive migration, CI drift job.
5. **Commit** one logical change per app with an imperative subject and a body that says
   what was wrong and why the fix is right; end with the session's attribution lines.

## Never
- Skip, `.only`, delete or loosen a test; lower coverage thresholds; disable a CI job or
  the secret scan; push to the deploy branch or merge PRs without the owner's approval.
- Put a password, token, OTP or key in code, tests or commit messages (generate test values
  at runtime, e.g. `randomUUID()`).

## CI failures
Read the failing job's steps and annotations (`gh api repos/<owner>/<repo>/actions/jobs/<id>`
and `/check-runs/<id>/annotations`). If the failure is not caused by the change (network
fetch of fonts, runner loss), re-run once; a second failure is real.

## Verify this skill worked
The new test fails on the old code and passes on the new; all gates green; the commit
message names the bug and the cause.
