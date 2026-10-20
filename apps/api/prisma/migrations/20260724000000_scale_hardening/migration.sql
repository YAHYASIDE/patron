-- ═══════════════════════════════════════════════════════════════
--  Patron — scale hardening (transactional statements)
--
--  Assumptions modelled: 100k users, 1M orders, ~3M order items,
--  ~6M provider calls, thousands of concurrent requests.
--  Everything here addresses something that is fine at 10k rows and
--  a problem at 1M.
--
--  NOTE: every `CREATE INDEX CONCURRENTLY` that used to live here now has
--  its own single-statement migration (20260724000001..000011). Prisma wraps
--  a multi-statement migration in a transaction, and Postgres forbids
--  CONCURRENTLY inside a transaction block; a single-statement migration runs
--  without one. This file keeps only the transaction-safe statements.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────── 1. Human-readable identifiers from a sequence ───────────────
--
-- Order and quote numbers used a random 8-char suffix. At 1M orders the
-- birthday bound makes collisions a real (if rare) 500, and a random suffix
-- gives support no ordering to work with. A sequence is monotonic, collision
-- free, and cheap.

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1000000;
CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1000000;

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

-- ─────────────── 10. Column statistics targets ───────────────
--
-- `status` columns are low cardinality but heavily skewed: almost every row is
-- COMPLETED, and the planner's default 100-bucket histogram badly misjudges the
-- rare values — which are exactly the ones operational queries filter on.

ALTER TABLE "orders"      ALTER COLUMN "status" SET STATISTICS 500;
ALTER TABLE "order_items" ALTER COLUMN "status" SET STATISTICS 500;
