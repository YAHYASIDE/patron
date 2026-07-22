-- Supports the incremental wallet-drift reconciliation (touched-since scan).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "wallets_updated_idx"
  ON "wallets" ("updatedAt");
