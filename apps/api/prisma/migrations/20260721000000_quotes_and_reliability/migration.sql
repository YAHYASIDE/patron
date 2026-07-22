-- ═══════════════════════════════════════════════════════════════
--  Patron — checkout quotes, reliability primitives, concurrency control
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE "QuoteStatus"   AS ENUM ('ACTIVE','CONSUMED','EXPIRED','CANCELLED');
CREATE TYPE "OutboxStatus"  AS ENUM ('PENDING','PUBLISHED','FAILED','DEAD');
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED','PROCESSED','DUPLICATE','FAILED');

-- ─────────────── Checkout quotes ───────────────

CREATE TABLE "checkout_quotes" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quoteNumber"   TEXT NOT NULL,
  "userId"        UUID NOT NULL,
  "status"        "QuoteStatus" NOT NULL DEFAULT 'ACTIVE',
  "subtotal"      DECIMAL(14,4) NOT NULL,
  "discount"      DECIMAL(14,4) NOT NULL DEFAULT 0,
  "fees"          DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxAmount"     DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxRate"       DECIMAL(6,4),
  "taxInclusive"  BOOLEAN NOT NULL DEFAULT false,
  "total"         DECIMAL(14,4) NOT NULL,
  "currency"      CHAR(3) NOT NULL,
  "baseCurrency"  CHAR(3) NOT NULL,
  "fxRate"        DECIMAL(20,10) NOT NULL,
  "fxRateId"      UUID,
  "totalBase"     DECIMAL(14,4) NOT NULL,
  "totalCostBase" DECIMAL(14,4) NOT NULL,
  "couponId"      UUID,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "consumedAt"    TIMESTAMP(3),
  "ipAddress"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_quotes_userId_fkey"   FOREIGN KEY ("userId")   REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "checkout_quotes_fxRateId_fkey" FOREIGN KEY ("fxRateId") REFERENCES "fx_rates"("id") ON DELETE SET NULL,
  CONSTRAINT "checkout_quotes_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL,
  CONSTRAINT "checkout_quotes_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "checkout_quotes_total_consistent" CHECK ("total" = "subtotal" - "discount" + "fees" + "taxAmount"),
  CONSTRAINT "checkout_quotes_fxRate_positive"  CHECK ("fxRate" > 0),
  CONSTRAINT "checkout_quotes_expiry_future"    CHECK ("expiresAt" > "createdAt")
);
CREATE UNIQUE INDEX "checkout_quotes_quoteNumber_key" ON "checkout_quotes"("quoteNumber");
CREATE INDEX "checkout_quotes_userId_status_idx" ON "checkout_quotes"("userId","status");
CREATE INDEX "checkout_quotes_status_expiresAt_idx" ON "checkout_quotes"("status","expiresAt");
-- the sweeper only ever scans live quotes
CREATE INDEX "checkout_quotes_active_expiry_idx" ON "checkout_quotes"("expiresAt") WHERE "status" = 'ACTIVE';

CREATE TABLE "quote_items" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quoteId"           UUID NOT NULL,
  "productId"         UUID NOT NULL,
  "productNameAr"     TEXT NOT NULL,
  "productNameEn"     TEXT NOT NULL,
  "quantity"          INTEGER NOT NULL DEFAULT 1,
  "unitPrice"         DECIMAL(14,4) NOT NULL,
  "unitPriceBase"     DECIMAL(14,4) NOT NULL,
  "unitCostBase"      DECIMAL(14,4) NOT NULL,
  "lineTotal"         DECIMAL(14,4) NOT NULL,
  "taxAmount"         DECIMAL(14,4) NOT NULL DEFAULT 0,
  "plannedProviderId" UUID,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quote_items_quoteId_fkey"   FOREIGN KEY ("quoteId")   REFERENCES "checkout_quotes"("id") ON DELETE CASCADE,
  CONSTRAINT "quote_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT,
  CONSTRAINT "quote_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "quote_items_line_total_consistent" CHECK ("lineTotal" = "unitPrice" * "quantity")
);
CREATE INDEX "quote_items_quoteId_idx" ON "quote_items"("quoteId");

CREATE TABLE "quote_item_inputs" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "quoteItemId" UUID NOT NULL,
  "fieldKey"    TEXT NOT NULL,
  "fieldLabel"  TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "quote_item_inputs_quoteItemId_fkey" FOREIGN KEY ("quoteItemId") REFERENCES "quote_items"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "quote_item_inputs_quoteItemId_fieldKey_key" ON "quote_item_inputs"("quoteItemId","fieldKey");

-- ─────────────── Reliability primitives ───────────────

CREATE TABLE "outbox_events" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "aggregate"   TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "eventType"   TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  "status"      "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "lastError"   TEXT,
  "publishedAt" TIMESTAMP(3),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events"("aggregate","aggregateId");
-- relay claim query: WHERE status='PENDING' AND availableAt <= now() ORDER BY availableAt
CREATE INDEX "outbox_events_claim_idx" ON "outbox_events"("availableAt") WHERE "status" = 'PENDING';

CREATE TABLE "idempotency_records" (
  "key"          TEXT PRIMARY KEY,
  "userId"       UUID,
  "endpoint"     TEXT NOT NULL,
  "requestHash"  TEXT NOT NULL,
  "statusCode"   INTEGER,
  "responseBody" JSONB,
  "lockedAt"     TIMESTAMP(3),
  "completedAt"  TIMESTAMP(3),
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");
CREATE INDEX "idempotency_records_userId_idx" ON "idempotency_records"("userId");

CREATE TABLE "inbound_webhooks" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"      TEXT NOT NULL,
  "eventId"     TEXT NOT NULL,
  "eventType"   TEXT NOT NULL,
  "signature"   TEXT,
  "headers"     JSONB,
  "payload"     JSONB NOT NULL,
  "status"      "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "error"       TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- replay protection: the same provider event can only ever land once
CREATE UNIQUE INDEX "inbound_webhooks_source_eventId_key" ON "inbound_webhooks"("source","eventId");
CREATE INDEX "inbound_webhooks_status_createdAt_idx" ON "inbound_webhooks"("status","createdAt");

CREATE TABLE "notification_templates" (
  "key"       TEXT PRIMARY KEY,
  "channels"  TEXT[] NOT NULL,
  "titleAr"   TEXT NOT NULL,
  "titleEn"   TEXT NOT NULL,
  "bodyAr"    TEXT NOT NULL,
  "bodyEn"    TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

-- ─────────────── Concurrency control ───────────────

ALTER TABLE "orders"      ADD COLUMN "quoteId" UUID,
                          ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "order_items" ADD COLUMN "plannedProviderId" UUID,
                          ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payments"    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "wallets"     ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "orders_quoteId_key" ON "orders"("quoteId");
ALTER TABLE "orders" ADD CONSTRAINT "orders_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "checkout_quotes"("id") ON DELETE SET NULL;

-- ─────────────── Hot-path indexes found during review ───────────────

-- customer "my orders" screen, newest first
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId","createdAt" DESC);
-- unpaid-order sweeper
CREATE INDEX "orders_awaiting_payment_idx" ON "orders"("createdAt") WHERE "status" = 'PENDING_PAYMENT';
-- reconciliation: payments captured but order not completed
CREATE INDEX "payments_captured_idx" ON "payments"("capturedAt") WHERE "status" = 'CAPTURED';
-- provider health dashboard scans recent failures only
CREATE INDEX "provider_calls_failures_idx" ON "provider_calls"("providerId","createdAt" DESC) WHERE "success" = false;
-- unread badge count
CREATE INDEX "notifications_unread_idx" ON "notifications"("userId","createdAt" DESC) WHERE "isRead" = false;
