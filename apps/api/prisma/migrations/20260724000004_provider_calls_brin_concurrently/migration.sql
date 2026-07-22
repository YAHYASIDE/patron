-- BRIN on the fastest-growing append-only table (kilobytes vs GB btree).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "provider_calls_created_brin"
  ON "provider_calls" USING BRIN ("createdAt") WITH (pages_per_range = 64);
