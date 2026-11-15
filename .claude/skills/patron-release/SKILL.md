---
name: patron-release
description: >-
  Pre-release checks, publishing and rollback for Patron on Render: what a merge into
  the deploy branch will do in production, migration safety rehearsal, backups first,
  CI green, deploy verification and the rollback plan. Use for "publish", "نشر",
  "deploy", "release", "rollback", "تراجع", or before merging any PR into
  claude/patron-monorepo-setup-1o2gl7. Never publish without the owner's explicit approval.
---

# Patron release

Render deploys `claude/patron-monorepo-setup-1o2gl7` (render.yaml: etssadagha-api,
etssadagha-shop = dashboard, etssadagha-store). `autoDeployTrigger: checksPass` and
`buildFilter` per service (a service rebuilds only when its paths change). The entrypoint
runs `prisma migrate deploy`, then the catalog pack (CATALOG_PACK=true; each pack runs once
by its marker), then the API.

## Before asking the owner to approve
1. **Scope**: `git diff --stat origin/<deploy>...<head>`; list migrations, catalog packs,
   render.yaml or env changes. Anything that changes or hides data must be named.
2. **CI**: every check on the exact head SHA green (`gh api repos/<o>/<r>/commits/<sha>/check-runs`).
3. **Migration rehearsal** on a copy of a realistic local DB: apply, check the result, roll
   back (drop what it added + delete its `_prisma_migrations` row), re-apply. Migrations must
   be additive (new tables, nullable columns, enum values, guarded indexes).
4. **Backup first**: the owner downloads a full backup from Settings (or the encrypted one).
5. **Risk report** (docs/DEPLOY_PLAN.md style): what changes, risks with likelihood and
   safeguard, rollback per part, what changes in the owner's daily work.

## Publish (only after the owner says so)
Fast-forward the deploy branch to the tested SHA (`git push origin <sha>:refs/heads/<deploy>`)
so the checks that passed are the checks on the deployed commit. Never push untested commits.

## Verify the deploy
- GitHub deployments for the SHA (`gh api repos/<o>/<r>/deployments?sha=<sha>`) — Render
  creates one per service when it starts. None after ~10 min means Render did not pick it up:
  the owner opens dashboard.render.com → service → "Manual Deploy" → "Deploy latest commit"
  (guide them with screenshots; the site is English).
- The "Live shop check" workflow comments on PR #1 ~12 min after a push; re-run it after the
  deploy finishes. Add a check in tests/live/check.mjs that proves the new version is live
  (e.g. a new route answering 401 instead of 404).

## Rollback
Render → service → Events → previous deploy → Rollback, or `git revert` the merge on the
deploy branch. Additive migrations do not need undoing; the old code ignores new tables.

## Verify this skill worked
The owner gets: CI result, rehearsal result, list of production effects, backup reminder,
rollback steps — and nothing was published without their explicit "yes".
