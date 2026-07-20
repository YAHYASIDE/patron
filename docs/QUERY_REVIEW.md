# Query review

Every query path, checked for execution plan, index support, locking behaviour,
transaction scope, memory profile, pagination and bulk-operation safety.

## Method

For each path: identify the access pattern, confirm an index serves it, check
the lock footprint and transaction boundary, and estimate rows examined at the
modelled scale (1M orders).

Run `EXPLAIN (ANALYZE, BUFFERS)` against a production-sized dataset before
launch; the plans below are the *expected* ones, and the point of writing them
down is that a deviation is then obvious.

## Hot path: checkout

| Query | Expected plan | Rows examined | Notes |
|---|---|---|---|
| `product.findFirst` (quote) | Index Scan `products_pkey` | 1 | Includes providers, ordered by priority |
| `pricing.getRate` | Index Scan `fx_rates_lookup_idx` | 1 | 5s in-process cache in front |
| `productCode.count` | Index Only Scan `product_codes_available_idx` | ~stock | Partial index, `isUsed = false` |
| `checkoutQuote.create` | Insert + 3 child inserts | — | One transaction, no external calls inside |
| `order.create` from quote | Insert + conditional quote update | — | Quote consumption is the concurrency guard |

**Transaction scope:** the quote→order transaction contains no network calls.
This is deliberate — a provider or gateway call inside an open transaction holds
row locks for the duration of someone else's outage.

## Hot path: fulfilment

| Query | Expected plan | Lock | Notes |
|---|---|---|---|
| `orderItem.updateMany` (claim) | Index Scan `order_items_pkey` | Row, brief | Conditional claim; the concurrency guard |
| `productProvider.findMany` | Index Scan `product_providers_productId_priority_idx` | None | |
| `providerCall.create` | Insert | None | Outside the delivery transaction, deliberately |
| `orderResult.createMany` + item update | Insert + update | Row | One transaction, no network calls |
| `order.syncStatus` | Index Scan + aggregate over items | Row | Bounded by items per order (≤20) |

**Lock footprint:** the fulfilment transaction opens *after* the provider call
returns. An HTTP call inside it would hold a row lock for up to 20 seconds.

## Wallet

| Query | Plan | Lock |
|---|---|---|
| `SELECT ... FOR UPDATE` | Index Scan `wallets_pkey` | Row, exclusive |
| `wallet.update` | Index Scan `wallets_pkey` | Row |
| `walletTransaction.create` | Insert | None |
| `findDrift` (incremental) | Index Scan `wallets_updated_idx` + hash aggregate | None |

Lock order is `wallet → order → payment → refund`, enforced by
`acquireLocks()`, which also sorts by id within a rank — two transactions
locking the same *pair* of wallets could otherwise still deadlock.

## Reporting

All reporting queries are bounded to 400 days by `DateRangeDto`. An unbounded
report is a full scan that will eventually take the database down at 3pm.

| Report | Path | Notes |
|---|---|---|
| `revenue` (default) | `daily_rollups` | ~90 rows for a quarter |
| `revenue/live` | `orders_paidAt_idx` | Exact; throttled to 5/min |
| `profit` | `orders_paidAt_idx` + join | Candidate for the rollup next |
| `providerPerformance` | `provider_calls_providerId_createdAt_idx` | `PERCENTILE_CONT` sorts within groups — the heaviest report |
| `failureAnalysis.stuck` | `orders_stuck_idx` (partial) | The query an operator runs during an incident; must be instant |
| `customerLifetimeValue` | CTE over `users` + `orders` | Heaviest analytics query; first candidate for a read replica |

## Bulk operations

| Operation | Batching | Why |
|---|---|---|
| Retention deletes | 10,000/pass, max 20 passes | Unbounded DELETE = lock + WAL spike |
| Quote expiry | 5,000/run | Bounded lock footprint |
| Unpaid order expiry | 500/run, one transaction | Was one transaction *per order* |
| Rollup recompute | One statement per run | `ON CONFLICT DO UPDATE`, idempotent |
| Outbox claim | 100/batch, `SKIP LOCKED` | Multiple relays without contention |

## Memory

No query loads an unbounded result set into Node:

- List endpoints cap at 100 (`@Max(100)`).
- Reports cap at 200 rows and 400 days.
- Retention and sweepers use explicit batch limits.
- Aggregation happens in Postgres, not by pulling rows into JavaScript.

**One exception, accepted:** CSV export builds the whole file in memory. At the
capped report sizes this is at most a few megabytes. A genuinely large export
should stream — documented in ADR 016 rather than pretended away.

## Index inventory

62 indexes across 40 tables. Partial indexes are used wherever a query only ever
touches a subset — pending fulfilment items, active quotes, failed logins,
unread notifications, paid-but-undelivered orders. A partial index on 2% of a
table is a fraction of the size and stays resident in memory.

**Caveat worth knowing:** a partial index is only used when the query's `WHERE`
clause matches the index predicate. Changing a filter can silently drop the
index and turn a range scan into a sequential one, with no error. Check
`EXPLAIN` when touching those paths.

## Anti-patterns audited for

| Pattern | Found | Status |
|---|---|---|
| N+1 queries | Product listing | Fixed (ADR 012) |
| `SELECT *` on wide tables | Explicit `select` everywhere | Clean |
| Unbounded result sets | Report ranges | Fixed |
| Network calls inside transactions | None | Clean |
| `OFFSET` on large tables | Order lists | Fixed |
| Missing indexes on FKs | None | Clean |
| Implicit cross joins | None | Clean |
| String interpolation in SQL | One `LIMIT` | Fixed (bound) |
