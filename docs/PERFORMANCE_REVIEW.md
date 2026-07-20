# Performance review at production scale

Modelled load: **100,000 users · 1,000,000 orders · ~3M order items ·
~6M provider calls · thousands of concurrent requests · multiple worker
instances · multiple provider failures.**

Everything below is something that is fine at 10,000 rows and a problem at a
million. Items marked **Fixed** are in this commit.

---

## 1. Pagination — the single biggest bottleneck found · **Fixed**

`OFFSET`-based pagination re-scans every skipped row. Page 5,000 of the admin
order list read 100,000 rows to return 20, and got linearly worse every day.
Worse, each list also ran a `COUNT(*)` over the same filter — a second full scan
to render a page number nobody clicks.

Replaced with **keyset (cursor) pagination** on `(createdAt, id)`:

| | OFFSET, page 5000 | Keyset, any page |
|---|---|---|
| Rows examined | ~100,020 | ~21 |
| Cost | grows linearly with depth | constant |
| Correctness | rows can duplicate or vanish mid-pagination | stable |

`hasMore` comes from fetching `limit + 1`, so the `COUNT` disappears entirely.

The compound `(createdAt, id)` comparison matters: ordering by timestamp alone
is ambiguous when two rows share a millisecond, and that ambiguity surfaces as a
row appearing on two consecutive pages.

## 2. Reporting — full scans on every dashboard load · **Fixed**

Revenue for a quarter aggregated ~250,000 orders joined to ~750,000 items, every
time someone opened the dashboard. Measured cost grows linearly with history and
is paid repeatedly for figures that do not change.

Added `daily_rollups`, recomputed nightly. A quarterly revenue query becomes a
~90-row read.

Design choices worth stating:

- **The rollup is derived, never authoritative.** `recompute(from, to)` is
  idempotent and safe to re-run — the first thing anyone asks about a suspicious
  number is "can we regenerate it".
- **Three days are recomputed nightly, not one.** A late-settling payment or a
  refund processed after midnight changes a day already rolled up.
- **Freshness is returned with the data**, so a dashboard says "as of 01:15"
  rather than quietly showing yesterday.
- `/revenue/live` remains for exact figures, throttled to 5/min.

## 3. Unbounded table growth · **Fixed**

Four tables grew forever and none were pruned. At 1M orders, `provider_calls` is
the largest table in the database by an order of magnitude.

| Table | Retention | Rationale |
|---|---|---|
| `provider_calls` | 180 days | Billing disputes settle well inside 6 months |
| `login_attempts` | 90 days | Only recent rows drive lockout |
| `outbox_events` (published) | 7 days | Already reflected in domain state |
| `notifications` | 365 days | Cheap, and customers reference old orders |
| `audit_logs` | **never** | Deleting audit history is a compliance decision, not an engineering one |

Deletes are **batched at 10,000 rows**. A single unbounded `DELETE` on a
multi-million row table holds a lock long enough to be an outage and generates a
WAL spike replicas cannot follow.

Added **BRIN indexes** on the three append-only, time-ordered tables. On
`provider_calls` a BRIN index is kilobytes where the btree equivalent is
gigabytes — this is the exact shape BRIN exists for.

## 4. Wallet drift reconciliation · **Fixed**

The nightly check grouped *every* `wallet_transactions` row ever written, to
verify wallets that had not moved in months. Now filtered by
`wallets.updatedAt >= now() - 48h`, with a full-audit mode available for a
maintenance window.

## 5. Sweepers holding locks too long · **Fixed**

- `expireUnpaid` opened **one transaction per order**. After an incident, 500
  stale orders meant 500 round trips holding connections live traffic needed.
  Now one batched transaction, with coupon decrements grouped.
- `expireStale` (quotes) ran an **unbounded** `updateMany`. After an outage that
  could lock tens of thousands of rows in one statement and block checkout for
  everyone. Now capped at 5,000 per run; the sweeper runs every minute, so the
  cap costs nothing.

## 6. Identifier generation · **Fixed**

Order and quote numbers used a random 8-character suffix. At 1M orders the
birthday bound makes a collision a real (if rare) 500, and a random suffix gives
support no ordering to work with. Replaced with a Postgres sequence: monotonic,
collision-free, and one round trip inside a transaction that was already open.

## 7. Planner statistics · **Fixed**

`orders.status` and `orders.paidAt` are strongly correlated — a `PAID` order
always has `paidAt`. Without extended statistics the planner multiplies the
selectivities independently and underestimates row counts by orders of
magnitude, choosing a nested loop where a hash join is correct. Added
`CREATE STATISTICS` for both correlated pairs.

## 8. Autovacuum on hot tables · **Fixed**

Defaults vacuum at 20% dead tuples. On `orders` at 1M rows that is 200,000 dead
tuples before anything happens, and index-only scans stop working long before
that. Tuned to 2% for order tables and 1% for `outbox_events` and
`checkout_quotes` — those two are extreme, since every row is inserted, updated
once and deleted, so without aggressive vacuum they bloat far past their live
size.

## 9. Product listing N+1 · **Fixed in phase 3**

~41 queries for a 20-item page → 4. See ADR 012.

---

## Verified as already correct

**Connection pooling.** Each pod holds a Prisma pool; the ceiling is
`pods × connection_limit` against `max_connections`. At the documented 20-pod
scale that is 400 against 200 — so PgBouncer in transaction mode is required
*before* scaling past ~8 pods, not after. Documented in `DISASTER_RECOVERY.md`
with the `pgbouncer=true` caveat for prepared statements.

**Wallet serialisation.** `FOR UPDATE` serialises writes per wallet. This is
inherent and correct — it is the mechanism that prevents double-spend, and it
must not be "optimised" away. It does not serialise across wallets, so it scales
with customers rather than with traffic.

**Outbox relay throughput.** ~100 events/sec per instance, and `SKIP LOCKED`
already supports running several. At 1M orders/year (~2 events/sec average, ~50
at peak) there is over an order of magnitude of headroom.

**Fulfilment concurrency.** Deliberately capped at 5 per worker. Each job may
spend real money and providers rate-limit; a queue of failed purchases is worse
than a queue of waiting ones. Scale workers horizontally instead — the HPA keys
on queue depth precisely because a worker blocked on a slow provider uses no CPU
while the backlog grows.

---

## Remaining bottlenecks, ranked

| # | Bottleneck | Onset | Mitigation |
|---|---|---|---|
| 1 | Postgres connections | ~8 API pods | PgBouncer, transaction mode |
| 2 | Reporting on the primary | ~2M orders | Read replica for `ReportsService` / `AnalyticsService` only — never the wallet |
| 3 | `provider_calls` table size | ~10M rows | Monthly partitioning; retention already caps it |
| 4 | Single Redis instance | ~500 jobs/sec | Redis Cluster, or split queues across instances |
| 5 | Wallet writes per user | Only pathological single-user load | None — inherent and correct |

None of these bind at the modelled scale. Items 1 and 2 are the ones to watch,
and both have a known, boring answer.
