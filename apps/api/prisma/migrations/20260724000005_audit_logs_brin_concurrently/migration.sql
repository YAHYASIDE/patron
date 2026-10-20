-- BRIN on the append-only, time-ordered audit log.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_logs_created_brin"
  ON "audit_logs" USING BRIN ("createdAt") WITH (pages_per_range = 64);
