# ADR 009 — Reporting uses raw SQL and reports in base currency

**Status:** Accepted · **Date:** 2026-07-22

## Context

Reports aggregate over every order and order item. Two problems: Prisma's
`groupBy` cannot express window functions, percentiles or date bucketing, and
orders exist in four currencies whose totals cannot be meaningfully summed.

## Decision

Reporting queries are hand-written SQL. All money is reported in the **base
currency** using the `totalBase` / `amountBase` / `unitCost` columns, which are
directly comparable because every order froze the FX rate it was priced with.

Date ranges default to 30 days and are capped at 400.

## Consequences

- Reports run in the database instead of pulling rows into Node to sum them.
- Percentile latency per provider is expressible (`PERCENTILE_CONT`), which the
  ORM cannot do.
- Profit reporting is *exact* rather than estimated, because provider cost was
  frozen at quote time (ADR 001). Without that freeze, margin could only be
  computed against today's costs.
- Raw SQL bypasses Prisma's type safety. Mitigated by explicit return types on
  every `$queryRaw` and by parameterising every input — the only
  `$queryRawUnsafe` calls interpolate a whitelisted bucket name, never user
  input.
- Schema changes can silently break a report. Reporting queries need coverage in
  the integration suite before the next schema change.
