# Backend review — phase 3

Full pass over the codebase looking for race conditions, deadlocks, missing
indexes, transaction boundaries, security weaknesses, performance bottlenecks,
duplicated logic and unnecessary complexity.

Findings are ordered by severity. Everything marked **Fixed** is in this commit.

---

## Severity 1 — correctness

### 1.1 Idempotency completion was fire-and-forget · **Fixed**

`IdempotencyInterceptor` wrote the stored response with `void this.idempotency.complete(...)`
inside `tap()`. The response was returned to the client before the record was
written. A client retrying within that window — precisely what happens on a
flaky mobile connection — got "still in progress" instead of the replay, and
would then retry again.

Now `switchMap`ed so the write completes before the response is emitted.

### 1.2 Payment capture could leave a payment CAPTURED against a cancelled order · **Fixed by test**

`markCaptured` calls `assertTransition` *inside* the transaction, after the
payment row has already been updated. The throw rolls the whole thing back, so
the behaviour was already correct — but nothing proved it. Added
`payments.webhook.spec.ts` › "rolls the whole capture back if the order
transition is illegal", which fails loudly if anyone moves that assertion
outside the transaction later.

### 1.3 Missing CHECK constraints let reports silently lie · **Fixed**

A `DELIVERED` item with a null `deliveredAt` is dropped from fulfilment-latency
averages rather than counted as slow. A `PROCESSED` refund with no
`processedById` is an unattributed money movement. A negative `unitCost` inflates
every profit figure.

Added constraints for all three, plus `capturedAt` on captured payments.

---

## Severity 2 — performance

### 2.1 N+1 in the public product listing · **Fixed**

`findAllPublic` called `pricing.priceProduct()` per product, and each call
re-fetched the product *and* looked up the FX rate. A 20-item page issued
roughly 41 queries. It also ran a separate stock-count query per product.

Now: one `pricingContext()` (rate + markup + currency), one `priceLoadedProduct()`
per row using already-loaded data, and two `groupBy` queries for the whole page's
stock. 20 products: 4 queries.

### 2.2 FX rate lookups repeated within a request · **Fixed**

Added a 5-second in-process cache in `PricingService.getRate`. Rates change
hourly at most. Quotes still read through and freeze the result, so a locked
price is never affected. Historical lookups (`getRate(currency, date)`) bypass
the cache.

### 2.3 Reporting had no supporting indexes · **Fixed**

Every revenue, profit and currency report filters on `orders.paidAt`, which had
no index — each report was a sequential scan. Eight reporting indexes added in
`20260722000000`, all `CONCURRENTLY` so deploying them does not lock the tables.

The most important one is `orders_stuck_idx`: paid-but-undelivered is the query
an operator runs during an incident, and it must be instant.

### 2.4 Login lockout could not use its indexes · **Fixed**

`assertNotLockedOut` counts failures matching `identifier OR ipAddress` in one
query. Postgres cannot combine the two separate indexes for an OR efficiently.
Added a partial index on `(createdAt DESC) WHERE NOT success`, which is a small
fraction of the table.

---

## Severity 3 — operability

### 3.1 No correlation between API and worker logs · **Fixed**

An order's lifecycle spans two processes. Added `AsyncLocalStorage`-based
request context and a correlation id that is honoured from inbound headers,
returned in responses, and mixed into every log line including those from queue
processors.

Chose ALS over Nest's request scoping deliberately: request scoping forces the
entire injection chain to be request-scoped (a real throughput cost) and does
not reach BullMQ workers at all.

### 3.2 Secrets could reach logs · **Fixed**

Redaction is now configured at the logger, covering authorization headers,
webhook signatures, passwords, OTP codes, refresh tokens and every `*Enc`
field — rather than relying on each call site to remember.

### 3.3 Health checking was absent · **Fixed**

Three endpoints, because Kubernetes asks three different questions. Liveness
depends on nothing external — a database blip must not restart every pod and
turn a degradation into an outage. Readiness checks dependencies plus outbox
backlog, since a stalled outbox means paid orders are silently not being
fulfilled.

Note: no healthy providers is a **readiness failure**, but a *partial* provider
outage is explicitly not — one healthy provider is enough to keep selling.

---

## Severity 4 — design

### 4.1 Duplicated order-number generation

`OrdersService.nextOrderNumber` and `QuotesService.nextQuoteNumber` are the same
function with a different prefix. Left as-is: extracting a two-line helper
shared across two modules would couple them for no benefit, and the prefixes are
likely to diverge (invoice numbering will need sequence guarantees that quote
numbers do not).

**Deliberately not fixed.** Noted so the next reviewer does not re-raise it.

### 4.2 `PrismaService.visible` extension is unused

The soft-delete extension exists but every call site passes `deletedAt: null`
explicitly. Explicit filters are easier to reason about and to review, and the
extension silently changing query semantics is a footgun.

**Recommendation:** delete the extension in the next cleanup pass rather than
adopt it. Kept for now to avoid churn mid-hardening.

### 4.3 Deadlock risk: lock ordering

Two transactions take row locks in different orders and deadlock. The paths that
lock more than one row are:

- Wallet payment: `wallets` (FOR UPDATE) → `orders` → `payments`
- Refund: `refunds` → `payments` → `orders` → `wallets`

These acquire in **opposite** order on the wallet/order pair. A wallet payment
and a wallet refund for the same user, concurrently, can deadlock.

**Mitigated, not eliminated.** In practice the window is tiny: refunds are
staff-initiated and an order being paid is not simultaneously being refunded.
Postgres detects deadlocks and aborts one side, which surfaces as a 500.

**Recommended convention, documented in ADR 010:** always acquire in the order
`wallet → order → payment → refund`. `RefundsService.process` should be
restructured to take the wallet lock first. Flagged rather than silently
rewritten, because it changes refund semantics under contention and deserves a
deliberate decision.

---

## Severity 5 — security

### 5.1 Metrics endpoint disclosed business data · **Fixed**

`/metrics` exposes order volume, revenue and provider names. Now requires a
bearer token when `METRICS_TOKEN` is set.

### 5.2 Metric label cardinality · **Reviewed, safe**

All labels are bounded sets (provider code, currency, status, route pattern).
The HTTP interceptor labels with `req.route.path` (`/orders/:id`), never the
resolved URL — labelling with an order id would create one time series per
order and eventually take Prometheus down.

### 5.3 Report date ranges were unbounded · **Fixed**

`DateRangeDto.resolve()` defaults to 30 days and rejects ranges over 400 days.
An unbounded report is a full table scan that will eventually take the database
down mid-afternoon.

### 5.4 Verified during review, no change needed

- Delivered codes never appear in list or detail payloads (asserted in e2e).
- Password hashes are excluded by explicit `select` on every user read.
- Webhook signatures compare in constant time and reject stale timestamps.
- Permissions resolve per request, so revocation is immediate.
- `forbidNonWhitelisted` rejects unknown properties rather than dropping them —
  a client sending `isBlocked: false` to `/auth/register` gets a 400, not a
  silent no-op.

---

## Remaining known gaps

| Gap | Impact | Owner |
|---|---|---|
| Provider adapter shapes unverified against sandboxes | Fulfilment fails on day one | Needs sandbox credentials |
| No FX feed configured | Stale rates on a 604:1 pair | Needs a feed provider decision |
| Refund/wallet lock ordering | Rare deadlock under contention | ADR 010 — needs approval |
| No distributed tracing | Cross-service latency is inferred | Next phase |
| Reports have no caching | Dashboard is recomputed per request | Acceptable at current volume |
