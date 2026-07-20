# ADR 017 — Keyset pagination, rollups and retention

**Status:** Accepted · **Date:** 2026-07-24

## Context

The platform was reviewed against 100k users and 1M orders. Three patterns that
are unremarkable at 10k rows fail at a million.

## Decisions

**Keyset pagination replaces OFFSET on order lists.** OFFSET re-scans every
skipped row — page 5,000 read 100,000 rows to return 20 — and each list also ran
a `COUNT(*)` over the same filter, a second full scan for a page number nobody
clicks. Keyset on `(createdAt, id)` costs the same at any depth, and `hasMore`
comes from fetching `limit + 1`, so the COUNT disappears.

The compound comparison is load-bearing: ordering by timestamp alone is
ambiguous when two rows share a millisecond, and that ambiguity shows up as a
row appearing on two consecutive pages.

**Daily rollups back the dashboards.** Aggregating a quarter of orders on every
dashboard load is a cost paid repeatedly for figures that do not change. The
rollup is derived, idempotent and rebuildable — `/revenue/live` remains for
exact figures.

Three days are recomputed nightly rather than one, because a late-settling
payment or an after-midnight refund changes a day already rolled up. Freshness
is returned with the data so a dashboard can say "as of 01:15" instead of
quietly showing yesterday.

**Retention policies on the four unbounded tables.** `provider_calls` is the
largest table in the system at scale — every attempt against every provider,
forever. Deletes are batched at 10,000; a single unbounded DELETE holds a lock
long enough to be an outage and produces a WAL spike replicas cannot follow.

`audit_logs` is deliberately excluded. Deleting audit history is a compliance
decision, not an engineering one.

## Consequences

- Order lists are constant-cost at any page depth.
- Clients must treat cursors as opaque. The API no longer returns a total count
  on order lists — a deliberate trade, since exact counts on a filtered 1M-row
  table were never cheap and rarely used.
- Dashboards are up to 24 hours stale unless `/live` is used. Made visible
  rather than hidden.
- BRIN indexes on the append-only tables are kilobytes where btree is gigabytes.
- Retention means data genuinely disappears. The windows are documented with
  their rationale so nobody shortens them casually.
