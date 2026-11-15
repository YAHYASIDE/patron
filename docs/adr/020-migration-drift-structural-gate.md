# ADR 020 — Migration drift is a structural-only gate

**Status:** Accepted · **Date:** 2026-07-22

## Context

The `api-drift` CI job asserted byte-for-byte equivalence between the migrations
and `schema.prisma` via `prisma migrate diff --exit-code`. That can never pass
here. The scale-hardening migrations (ADR 017) deliberately create objects that
Prisma's schema language cannot express — **BRIN**, **GIN trigram**, **partial**
and **keyset** indexes — plus DB-side `gen_random_uuid()` id defaults and FK
`ON UPDATE` actions. `migrate diff` therefore reports a 469-line difference on
every run, even though it contains no *structural* change: every table, column,
type and nullability already matches.

So the choice was: drop the performance indexes, hand-reconcile ~130 schema
lines (changing UUID generation semantics) and *still* be unable to model the
raw indexes — or change what "drift" means.

## Decision

The gate asserts there is **no structural drift** rather than exact equivalence.
It generates the migrations→schema diff as SQL and fails only if that diff adds,
drops, retypes or renames a table or column — the changes that would actually
break the Prisma Client or lose data — while tolerating the intended operational
layer (indexes, id/FK defaults). `set -euo pipefail` ensures a `migrate diff`
error (a broken migration, an unreachable shadow DB) still fails the step rather
than being read as "no drift."

`schema.prisma` remains the source of truth for the logical model; the migrations
additionally carry an operational layer that lives only in raw SQL.

## Consequences

- The job goes green while the performance indexes are kept.
- A genuinely dangerous hand-edit (a removed column, a retyped field) still
  fails the gate.
- `schema.prisma` is intentionally not identical to the migrated database. A new
  engineer must know that the extra indexes/defaults are real and deliberate.
- If the team later adopts tooling that can model these objects, the gate can be
  tightened again — a new ADR would record that.
