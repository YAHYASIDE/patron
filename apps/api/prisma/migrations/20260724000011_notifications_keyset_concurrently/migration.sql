-- Keyset pagination for the customer notification feed.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_keyset_idx"
  ON "notifications" ("userId", "createdAt" DESC, "id" DESC);
