# Architecture Decision Records

Each record states the decision, why it was taken, and what it costs.
Superseding a decision means adding a new record, not editing an old one.

| # | Decision | Status |
|---|---|---|
| [001](001-checkout-quote-price-lock.md) | Checkout quote with a 15-minute price lock | Accepted |
| [002](002-provider-engine-strategy.md) | Provider Engine: strategy + registry, no hardcoded provider logic | Accepted |
| [003](003-transactional-outbox.md) | Transactional outbox for all side effects | Accepted |
| [004](004-idempotency.md) | Idempotency keys on money-moving endpoints | Accepted |
| [005](005-wallet-ledger.md) | Wallet as an append-only ledger with row locking | Accepted |
| [006](006-derived-order-status.md) | Order status is derived from its items | Accepted |
| [007](007-multi-currency.md) | Multi-currency: base pricing, overrides, frozen rates | Accepted |
| [008](008-observability.md) | Observability: ALS context, business-first metrics | Accepted |
| [009](009-reporting-raw-sql.md) | Reporting in raw SQL, reported in base currency | Accepted |
| [010](010-lock-ordering.md) | Global lock acquisition ordering | **Proposed** |
| [011](011-test-strategy.md) | Test strategy: real database, HTTP-level stubs | Accepted |
| [012](012-performance.md) | Batch pricing, cached rates, partial indexes | Accepted |
| [013](013-lock-ordering-accepted.md) | Lock ordering, implemented | Accepted |
| [014](014-tracing.md) | Distributed tracing with OpenTelemetry | Accepted |
| [015](015-deployment.md) | Deployment topology | Accepted |
| [016](016-report-exports.md) | CSV export written by hand | Accepted |
| [017](017-scale-hardening.md) | Keyset pagination, rollups and retention | Accepted |
| [018](018-simplification.md) | Removing complexity that was not earning its keep | Accepted |
| [019](019-error-envelope.md) | One error shape, correlation id always present | Accepted |
