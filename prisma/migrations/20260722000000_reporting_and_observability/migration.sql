-- ═══════════════════════════════════════════════════════════════
--  Patron — indexes required by the reporting module, plus fixes
--  found during the backend review.
-- ═══════════════════════════════════════════════════════════════

-- ─────────────── Reporting hot paths ───────────────

-- Every revenue/profit/currency report filters on paidAt over a range.
-- Without this, each report is a sequential scan of the orders table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_paidAt_idx"
  ON "orders" ("paidAt") WHERE "paidAt" IS NOT NULL;

-- Currency breakdown groups by currency within a date range.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_currency_paidAt_idx"
  ON "orders" ("currency", "paidAt") WHERE "paidAt" IS NOT NULL;

-- Provider fulfilment report joins on the delivering provider.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_provider_delivered_idx"
  ON "order_items" ("fulfilledByProviderId", "deliveredAt")
  WHERE "status" = 'DELIVERED';

-- Product performance groups by product over a range.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_product_created_idx"
  ON "order_items" ("productId", "createdAt");

-- Refund reports filter on processedAt, not createdAt.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "refunds_processedAt_idx"
  ON "refunds" ("processedAt") WHERE "status" = 'PROCESSED';

-- Failure analysis reads only failed calls in a window.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "provider_calls_error_idx"
  ON "provider_calls" ("errorCode", "createdAt") WHERE NOT "success";

-- The single most important operational query: paid but undelivered.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_stuck_idx"
  ON "orders" ("paidAt") WHERE "status" IN ('PAID', 'PROCESSING');

-- Customer reports: new signups in a range.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "users_created_active_idx"
  ON "users" ("createdAt") WHERE "deletedAt" IS NULL;

-- ─────────────── Review findings ───────────────

-- A user must not hold two ACTIVE quotes for the same idempotent submission,
-- and the "my open quotes" lookup should not scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "checkout_quotes_user_active_idx"
  ON "checkout_quotes" ("userId", "createdAt" DESC) WHERE "status" = 'ACTIVE';

-- Reveal endpoint and delivery both look up results by item.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_results_item_delivered_idx"
  ON "order_results" ("orderItemId", "deliveredAt" DESC);

-- Login lockout counts failures per identifier AND per ip in one query;
-- the existing two indexes could not serve the OR efficiently.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "login_attempts_failed_recent_idx"
  ON "login_attempts" ("createdAt" DESC) WHERE NOT "success";

-- Session listing and bulk revoke on block/password change.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "refresh_tokens_active_idx"
  ON "refresh_tokens" ("userId") WHERE "revokedAt" IS NULL;

-- ─────────────── Integrity fixes found during review ───────────────

-- An order item's frozen cost must never be negative; a negative cost would
-- silently inflate every profit report.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_cost_non_negative" CHECK ("unitCost" >= 0);

-- A quote's frozen cost is the basis of the margin report.
ALTER TABLE "checkout_quotes"
  ADD CONSTRAINT "checkout_quotes_cost_non_negative" CHECK ("totalCostBase" >= 0);

-- A delivered item must have a delivery timestamp: reports measure fulfilment
-- latency from it, and a NULL silently drops the row from the average.
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_delivered_has_timestamp"
  CHECK ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL);

-- A captured payment must record when. Reconciliation depends on it.
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_captured_has_timestamp"
  CHECK ("status" <> 'CAPTURED' OR "capturedAt" IS NOT NULL);

-- A processed refund must record who processed it — an unattributed refund is
-- an audit failure.
ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_processed_has_actor"
  CHECK ("status" <> 'PROCESSED' OR ("processedById" IS NOT NULL AND "processedAt" IS NOT NULL));
