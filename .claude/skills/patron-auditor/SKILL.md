---
name: patron-auditor
description: >-
  Audit the Patron monorepo for bugs, money-path risks, security gaps, broken UX and
  test gaps, and produce a ranked findings list with evidence. Use when asked to
  "audit", "inspect", "find bugs", "فحص", "تدقيق", review the state of the shop before
  a release, or after a large merge. Not for fixing (hand findings to patron-auto-fixer).
---

# Patron auditor

Find what is wrong, prove it, rank it. Never fix during an audit: a finding that was
"fixed while looking" has no evidence and no test.

## When to use
- Before a release or a merge into the deploy branch (`claude/patron-monorepo-setup-1o2gl7`).
- After a large feature lands (V2: auth, USDT, agents, backups, notifications).
- When the owner reports "something is wrong" without a precise bug.

## Procedure
1. **Baseline**: from the repo root run the gates and keep the numbers:
   - `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx eslint "{src,test}/**/*.ts" --max-warnings 0`
   - `npx jest --config test/jest-unit.json --coverage` (record suites/tests/coverage)
   - integration/e2e with a throwaway DB (see patron-live-tester for the stack).
   - `cd apps/admin && npx tsc --noEmit && npm run lint:check`; same in `apps/storefront`.
2. **Money paths first** (load patron-payment-guardian): wallet debit/credit, payment
   capture, refunds, order state machine, commissions, USDT orders. Look for missing row
   locks, non-idempotent writes, totals trusted from the client, transitions that skip states.
3. **Security** (load patron-security): permissions on every `/admin/*` route, staff-only
   fields leaking to customers (`forCustomer`/`itemForCustomer`), secrets in code/logs,
   open redirects, rate limits, uploads.
4. **Data safety** (load patron-backup): every table money depends on is in `BackupService`
   TABLES; restore test passes.
5. **UX** (load patron-ui-ux): Arabic copy, fr/en dictionaries complete
   (`node <scratchpad>/i18n-check.mjs` from apps/storefront), 390px layouts, empty/error states.
6. **Live** (load patron-live-tester): a real purchase in a browser on a local stack.

## Evidence rules
- Each finding: ID (C=critical/H=high/M=medium/L=low), one-line problem, impact on the
  owner or customer, exact file:line, reproduction (command, request or click path),
  and the observed result. No finding without a reproduction or a code citation.
- Mark anything not run as "not verified".

## Output
`docs/PATRON_AUDIT_REPORT.md` style: score per area (/10), findings table sorted by
severity, test numbers, and what needs the owner (keys, approvals). Arabic for the owner.

## Verify this skill worked
The report cites at least one command output per area and every critical/high finding
has a file:line and a reproduction a second person can run.
