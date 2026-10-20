-- BRIN on the append-only login-attempt log.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "login_attempts_created_brin"
  ON "login_attempts" USING BRIN ("createdAt") WITH (pages_per_range = 64);
