# ADR 012 — Query performance: batch pricing, cached rates, partial indexes

**Status:** Accepted · **Date:** 2026-07-22

## Context

The storefront product listing was the worst offender in the codebase: for each
product it re-fetched the product, looked up the FX rate, and ran a stock count.
A 20-item page issued roughly 41 queries.

Separately, every reporting query filtered on `orders.paidAt`, which had no
index — each report was a sequential scan that would get slower every day.

## Decision

**Batch pricing.** `PricingService.pricingContext()` resolves currency, rate and
markup once per request; `priceLoadedProduct()` prices an already-loaded row
without re-querying. Stock for a whole page resolves in two `groupBy` queries.

**Cache FX rates for 5 seconds** in-process. Rates change hourly at most.
Quotes still read through `getRate` and freeze the result, so a locked price is
never served from a stale cache. Historical lookups bypass it entirely.

**Partial indexes over full ones** where the query only ever touches a subset:
pending fulfilment items, active quotes, failed login attempts, unread
notifications, paid-but-undelivered orders. A partial index on 2% of a table is
a fraction of the size and stays in memory.

All reporting indexes are created `CONCURRENTLY` so deploying them does not lock
the table.

## Consequences

- Product listing: ~41 queries → 4.
- Reports go from sequential scans to index scans.
- Up to 5 seconds of rate staleness on *display* prices. A customer could see a
  price and get a quote a fraction of a percent different. Acceptable: the quote
  is what binds, and it is generated from a fresh read.
- Partial indexes are only used when the query's WHERE clause matches the
  index's predicate. Changing a query's filter can silently drop the index —
  worth checking `EXPLAIN` when touching these paths.
