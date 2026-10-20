-- GIN trigram: admin order-number search (LIKE '%...%' no btree can serve).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "orders_number_trgm_idx"
  ON "orders" USING GIN ("orderNumber" gin_trgm_ops);
