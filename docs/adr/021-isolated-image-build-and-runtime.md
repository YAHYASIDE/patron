# ADR 021 — Self-contained image build and an npm-free runtime

**Status:** Accepted · **Date:** 2026-07-22

## Context

Per ADR 015 and rule 9 in `CLAUDE.md`, each deployable app's Docker **build
context is the app directory**, not the repo root, so an image build is
reproducible from that app alone. Two things collided with that when the image
build first ran (it had been gated behind other jobs and never executed before):

1. `apps/api/tsconfig.json` extends `../../packages/tsconfig/nestjs.json`. That
   path does not exist inside an `apps/api`-only build context, so `nest build`
   compiled without `experimentalDecorators` and failed with 811 decorator
   errors.
2. The Trivy image scan reported 1 CRITICAL + 4 HIGH vulnerabilities — all in
   the **npm CLI bundled in `node:22-alpine`** (`tar`, `sigstore`, `picomatch`,
   `brace-expansion`), none of them application dependencies.

## Decision

- **Build:** add a self-contained `apps/api/tsconfig.build.json` (Nest picks it
  up automatically) that inlines the compiler options from
  `@patron/tsconfig/nestjs.json` + `base.json`. The dev `tsconfig.json` still
  extends the shared config for the monorepo typecheck; only the isolated image
  build uses the self-contained one.
- **Runtime:** the runtime stage runs only `node dist/main` and never shells out
  to npm, so the bundled npm/npx is removed from the final image
  (`rm -rf /usr/local/lib/node_modules/npm …`). The build/prod-deps stages still
  use npm to install dependencies; only the shipped image is stripped.
- **Scan wiring:** the image is built with `load: true` and scanned locally by
  Trivy using a **lowercased** image reference (`${GITHUB_REPOSITORY,,}`); a raw
  `github.repository` keeps the owner's original case and is an invalid Docker
  reference. The image is pushed to `ghcr.io` only on a push to `main`.

## Consequences

- The image builds and scans clean; the Build API image CI job is green.
- Smaller runtime image and a reduced attack surface (no package manager in
  production).
- **Cost:** `tsconfig.build.json` duplicates the shared compiler options and
  must be kept in sync with `packages/tsconfig` by hand (a comment says so). The
  cleaner long-term fix is to publish/vendor `@patron/tsconfig` so the isolated
  build can resolve it; recorded as debt in `HANDOVER.md`.
- The scan gate itself is unchanged (CRITICAL/HIGH, `exit-code 1`,
  `ignore-unfixed`); nothing was suppressed to make it pass.
