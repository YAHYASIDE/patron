-- Keyset pagination: orders list (index-only range scan regardless of depth).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_keyset_idx"
  ON "orders" ("createdAt" DESC, "id" DESC);
