-- Keyset pagination: admin order list filtered by status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_status_keyset_idx"
  ON "orders" ("status", "createdAt" DESC, "id" DESC);
