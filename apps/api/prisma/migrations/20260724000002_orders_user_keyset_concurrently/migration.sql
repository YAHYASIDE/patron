-- Keyset pagination: a single customer's order history.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_user_keyset_idx"
  ON "orders" ("userId", "createdAt" DESC, "id" DESC);
