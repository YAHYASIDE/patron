-- ═══════════════════════════════════════════════════════════════
--  Patron — scale hardening
--
--  Assumptions modelled: 100k users, 1M orders, ~3M order items,
--  ~6M provider calls, thousands of concurrent requests.
--  Everything here addresses something that is fine at 10k rows and
--  a problem at 1M.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────── 1. Human-readable identifiers from a sequence ───────────────
--
-- Order and quote numbers used a random 8-char suffix. At 1M orders the
-- birthday bound makes collisions a real (if rare) 500, and a random suffix
-- gives support no ordering to work with. A sequence is monotonic, collision
-- free, and cheap.

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000000;
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1000000;

-- ─────────────── 2. Keyset pagination support ───────────────
--
-- OFFSET-based pagination re-scans every skipped row: page 5,000 of the admin
-- order list reads 100,000 rows to return 20. These indexes make the keyset
-- (cursor) queries an index-only range scan regardless of depth.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_keyset_idx"
  ON "orders" ("createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_user_keyset_idx"
  ON "orders" ("userId", "createdAt" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_keyset_idx"
  ON "orders" ("status", "createdAt" DESC, "id" DESC);

-- ─────────────── 3. Reporting rollups ───────────────
--
-- Aggregating 1M orders per dashboard load is a sequential scan nobody should
-- pay for repeatedly. A nightly rollup turns "revenue for last quarter" from
-- minutes into a 90-row read. The raw tables remain the source of truth; the
-- rollup is rebuildable from them at any time.

CREATE TABLE IF NOT EXISTS "daily_rollups" (
  "day"            DATE NOT NULL,
  "currency"       CHAR(3) NOT NULL,
  "orders"         INTEGER NOT NULL DEFAULT 0,
  "paidOrders"     INTEGER NOT NULL DEFAULT 0,
  "failedOrders"   INTEGER NOT NULL DEFAULT 0,
  "itemsDelivered" INTEGER NOT NULL DEFAULT 0,
  "itemsFailed"    INTEGER NOT NULL DEFAULT 0,
  "grossBase"      DECIMAL(18,4) NOT NULL DEFAULT 0,
  "discountBase"   DECIMAL(18,4) NOT NULL DEFAULT 0,
  "refundBase"     DECIMAL(18,4) NOT NULL DEFAULT 0,
  "costBase"       DECIMAL(18,4) NOT NULL DEFAULT 0,
  "newCustomers"   INTEGER NOT NULL DEFAULT 0,
  "computedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "daily_rollups_pkey" PRIMARY KEY ("day", "currency")
);
CREATE INDEX IF NOT EXISTS "daily_rollups_day_idx" ON "daily_rollups" ("day" DESC);

-- ─────────────── 4. High-churn table hygiene ───────────────
--
-- provider_calls is the fastest-growing table in the system: every attempt
-- against every provider, forever. At 1M orders it is the largest table by an
-- order of magnitude, and it is append-only and time-ordered — the exact shape
-- BRIN was designed for. A BRIN index here is kilobytes where a btree is
-- gigabytes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "provider_calls_created_brin"
  ON "provider_calls" USING BRIN ("createdAt") WITH (pages_per_range = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_created_brin"
  ON "audit_logs" USING BRIN ("createdAt") WITH (pages_per_range = 64);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "login_attempts_created_brin"
  ON "login_attempts" USING BRIN ("createdAt") WITH (pages_per_range = 64);

-- Retention deletes scan by createdAt; a partial index on published rows keeps
-- the outbox purge from touching live events.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_published_idx"
  ON "outbox_events" ("publishedAt") WHERE "status" = 'PUBLISHED';

-- ─────────────── 5. Incremental drift detection ───────────────
--
-- The nightly reconciliation grouped every wallet_transactions row ever
-- written. Only wallets touched since the last run can have drifted.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "wallets_updated_idx"
  ON "wallets" ("updatedAt");

-- ─────────────── 6. Autovacuum tuning for hot tables ───────────────
--
-- Defaults vacuum at 20% dead tuples. On a table with millions of rows that is
-- hundreds of thousands of dead tuples before anything happens, and index-only
-- scans stop working long before that.

ALTER TABLE "orders"          SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "order_items"     SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "provider_calls"  SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE "outbox_events"   SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "checkout_quotes" SET (autovacuum_vacuum_scale_factor = 0.01, autovacuum_analyze_scale_factor = 0.01);
-- The outbox and quote tables are extreme: rows are inserted, updated once and
-- deleted. Without aggressive vacuum they bloat far beyond their live size.

-- ─────────────── 7. Statistics for the planner ───────────────
--
-- status and paidAt are strongly correlated (a PAID order always has paidAt).
-- Without extended statistics the planner multiplies the selectivities and
-- underestimates rows by orders of magnitude, choosing a nested loop where a
-- hash join is right.

CREATE STATISTICS IF NOT EXISTS orders_status_paid_stats (dependencies)
  ON "status", "paidAt" FROM "orders";

CREATE STATISTICS IF NOT EXISTS order_items_status_delivered_stats (dependencies)
  ON "status", "deliveredAt" FROM "order_items";

-- ─────────────── 9. Admin order search ───────────────
--
-- The admin list supports search by order number, which is a `contains` — a
-- LIKE '%...%' that no btree can serve. At 1M orders that is a sequential scan
-- on the busiest support screen.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_number_trgm_idx"
  ON "orders" USING GIN ("orderNumber" gin_trgm_ops);

-- ─────────────── 10. Column statistics targets ───────────────
--
-- `status` columns are low cardinality but heavily skewed: almost every row is
-- COMPLETED, and the planner's default 100-bucket histogram badly misjudges the
-- rare values — which are exactly the ones operational queries filter on.

ALTER TABLE "orders"      ALTER COLUMN "status" SET STATISTICS 500;
ALTER TABLE "order_items" ALTER COLUMN "status" SET STATISTICS 500;

-- Supports the incremental drift join (wallets touched recently → their ledger).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "wallet_transactions_recent_idx"
  ON "wallet_transactions" ("walletId", "createdAt" DESC);

-- Keyset pagination for the customer notification feed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_keyset_idx"
  ON "notifications" ("userId", "createdAt" DESC, "id" DESC);
