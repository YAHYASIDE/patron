-- Supports the incremental drift join (wallets touched recently -> their ledger).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "wallet_transactions_recent_idx"
  ON "wallet_transactions" ("walletId", "createdAt" DESC);
