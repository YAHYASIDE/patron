-- ═══════════════════════════════════════════════════════════════
--  Patron Platform — Initial migration
--  PostgreSQL 15+
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- fuzzy catalog search

-- ─────────────── Enums ───────────────

CREATE TYPE "ProductType"         AS ENUM ('GAME_TOPUP','GIFT_CARD','SUBSCRIPTION','LICENSE');
CREATE TYPE "DeliveryMode"        AS ENUM ('AUTO_PROVIDER','CODE_POOL','MANUAL');
CREATE TYPE "OrderStatus"         AS ENUM ('PENDING_PAYMENT','PAID','PROCESSING','COMPLETED','PARTIALLY_COMPLETED','FAILED','REFUNDED','CANCELLED');
CREATE TYPE "OrderItemStatus"     AS ENUM ('PENDING','PROCESSING','DELIVERED','FAILED','REFUNDED','CANCELLED');
CREATE TYPE "PaymentStatus"       AS ENUM ('INITIATED','AUTHORIZED','CAPTURED','FAILED','REFUNDED','PARTIALLY_REFUNDED');
CREATE TYPE "PaymentGateway"      AS ENUM ('WALLET','MOYASAR','TAP','STRIPE','MANUAL');
CREATE TYPE "RefundStatus"        AS ENUM ('REQUESTED','APPROVED','REJECTED','PROCESSED');
CREATE TYPE "DiscountType"        AS ENUM ('PERCENT','FIXED');
CREATE TYPE "WalletTxnType"       AS ENUM ('TOPUP','ORDER_PAYMENT','REFUND','ADMIN_ADJUSTMENT','CASHBACK');
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP','EMAIL','SMS','PUSH');
CREATE TYPE "VerificationPurpose" AS ENUM ('EMAIL_VERIFY','PHONE_VERIFY','PASSWORD_RESET','TWO_FACTOR');
CREATE TYPE "DevicePlatform"      AS ENUM ('IOS','ANDROID','WEB');

-- ─────────────── Currency & FX ───────────────

CREATE TABLE "currencies" (
  "code"         CHAR(3) PRIMARY KEY,
  "nameAr"       TEXT NOT NULL,
  "nameEn"       TEXT NOT NULL,
  "symbol"       TEXT NOT NULL,
  "decimals"     INTEGER NOT NULL DEFAULT 2,
  "isBase"       BOOLEAN NOT NULL DEFAULT false,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "roundingMode" TEXT NOT NULL DEFAULT 'HALF_UP',
  "roundingStep" DECIMAL(14,4),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "currencies_decimals_range" CHECK ("decimals" BETWEEN 0 AND 4),
  CONSTRAINT "currencies_rounding_mode" CHECK ("roundingMode" IN ('HALF_UP','UP','DOWN'))
);
CREATE INDEX "currencies_isActive_sortOrder_idx" ON "currencies"("isActive","sortOrder");
-- exactly one base currency, enforced by the database
CREATE UNIQUE INDEX "currencies_single_base_idx" ON "currencies"(("isBase")) WHERE "isBase" = true;

CREATE TABLE "fx_rates" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "baseCurrency"  CHAR(3) NOT NULL,
  "quoteCurrency" CHAR(3) NOT NULL,
  "rate"          DECIMAL(20,10) NOT NULL,
  "source"        TEXT NOT NULL DEFAULT 'MANUAL',
  "effectiveAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"     TIMESTAMP(3),
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdById"   UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fx_rates_baseCurrency_fkey"  FOREIGN KEY ("baseCurrency")  REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "fx_rates_quoteCurrency_fkey" FOREIGN KEY ("quoteCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "fx_rates_rate_positive" CHECK ("rate" > 0),
  CONSTRAINT "fx_rates_distinct_pair"  CHECK ("baseCurrency" <> "quoteCurrency")
);
CREATE UNIQUE INDEX "fx_rates_pair_effectiveAt_key" ON "fx_rates"("baseCurrency","quoteCurrency","effectiveAt");
CREATE INDEX "fx_rates_lookup_idx" ON "fx_rates"("baseCurrency","quoteCurrency","isActive","effectiveAt" DESC);

-- ─────────────── Users & access control ───────────────

CREATE TABLE "users" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"           TEXT NOT NULL,
  "phone"           TEXT,
  "passwordHash"    TEXT NOT NULL,
  "fullName"        TEXT NOT NULL,
  "avatarUrl"       TEXT,
  "locale"          TEXT NOT NULL DEFAULT 'ar',
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "isBlocked"       BOOLEAN NOT NULL DEFAULT false,
  "emailVerifiedAt" TIMESTAMP(3),
  "phoneVerifiedAt" TIMESTAMP(3),
  "twoFaSecretEnc"  TEXT,
  "twoFaEnabled"    BOOLEAN NOT NULL DEFAULT false,
  "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'USD',
  "lastLoginAt"     TIMESTAMP(3),
  "lastLoginIp"     TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "deletedAt"       TIMESTAMP(3),
  CONSTRAINT "users_defaultCurrency_fkey" FOREIGN KEY ("defaultCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
CREATE INDEX "users_createdAt_idx" ON "users"("createdAt");

CREATE TABLE "roles" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

CREATE TABLE "permissions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "key"         TEXT NOT NULL,
  "module"      TEXT NOT NULL,
  "description" TEXT
);
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

CREATE TABLE "user_roles" (
  "userId"     UUID NOT NULL,
  "roleId"     UUID NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId"),
  CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE
);
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

CREATE TABLE "role_permissions" (
  "roleId"       UUID NOT NULL,
  "permissionId" UUID NOT NULL,
  CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId"),
  CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE,
  CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE
);
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

CREATE TABLE "refresh_tokens" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "tokenHash"  TEXT NOT NULL,
  "deviceInfo" TEXT,
  "ipAddress"  TEXT,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),
  "replacedBy" UUID,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_revokedAt_idx" ON "refresh_tokens"("userId","revokedAt");
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

CREATE TABLE "verification_tokens" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "purpose"    "VerificationPurpose" NOT NULL,
  "codeHash"   TEXT NOT NULL,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "attempts"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "verification_tokens_userId_purpose_consumedAt_idx" ON "verification_tokens"("userId","purpose","consumedAt");
CREATE INDEX "verification_tokens_expiresAt_idx" ON "verification_tokens"("expiresAt");

CREATE TABLE "login_attempts" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "identifier" TEXT NOT NULL,
  "ipAddress"  TEXT NOT NULL,
  "success"    BOOLEAN NOT NULL,
  "reason"     TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "login_attempts_identifier_createdAt_idx" ON "login_attempts"("identifier","createdAt");
CREATE INDEX "login_attempts_ipAddress_createdAt_idx" ON "login_attempts"("ipAddress","createdAt");

CREATE TABLE "device_tokens" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID NOT NULL,
  "token"      TEXT NOT NULL,
  "platform"   "DevicePlatform" NOT NULL,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");
CREATE INDEX "device_tokens_userId_isActive_idx" ON "device_tokens"("userId","isActive");

-- ─────────────── Catalog ───────────────

CREATE TABLE "categories" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"      TEXT NOT NULL,
  "nameAr"    TEXT NOT NULL,
  "nameEn"    TEXT NOT NULL,
  "iconUrl"   TEXT,
  "bannerUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "parentId"  UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL,
  CONSTRAINT "categories_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id")
);
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");
CREATE INDEX "categories_isActive_sortOrder_idx" ON "categories"("isActive","sortOrder");

CREATE TABLE "games" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"        TEXT NOT NULL,
  "nameAr"      TEXT NOT NULL,
  "nameEn"      TEXT NOT NULL,
  "description" TEXT,
  "coverUrl"    TEXT,
  "logoUrl"     TEXT,
  "publisher"   TEXT,
  "sortOrder"   INTEGER NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN NOT NULL DEFAULT true,
  "isFeatured"  BOOLEAN NOT NULL DEFAULT false,
  "categoryId"  UUID NOT NULL,
  "inputSchema" JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "games_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");
CREATE INDEX "games_categoryId_isActive_idx" ON "games"("categoryId","isActive");
CREATE INDEX "games_isFeatured_idx" ON "games"("isFeatured");
CREATE INDEX "games_name_trgm_idx" ON "games" USING GIN ("nameEn" gin_trgm_ops, "nameAr" gin_trgm_ops);

CREATE TABLE "products" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sku"           TEXT NOT NULL,
  "type"          "ProductType" NOT NULL,
  "delivery"      "DeliveryMode" NOT NULL,
  "nameAr"        TEXT NOT NULL,
  "nameEn"        TEXT NOT NULL,
  "description"   TEXT,
  "imageUrl"      TEXT,
  "costPrice"     DECIMAL(14,4) NOT NULL,
  "sellPrice"     DECIMAL(14,4) NOT NULL,
  "currency"      CHAR(3) NOT NULL,
  "stockQty"      INTEGER,
  "lowStockAlert" INTEGER DEFAULT 5,
  "maxPerOrder"   INTEGER NOT NULL DEFAULT 10,
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "isFeatured"    BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "metadata"      JSONB,
  "categoryId"    UUID NOT NULL,
  "gameId"        UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "deletedAt"     TIMESTAMP(3),
  CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT,
  CONSTRAINT "products_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL,
  CONSTRAINT "products_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "products_prices_non_negative" CHECK ("costPrice" >= 0 AND "sellPrice" >= 0),
  CONSTRAINT "products_stock_non_negative" CHECK ("stockQty" IS NULL OR "stockQty" >= 0),
  CONSTRAINT "products_max_per_order_positive" CHECK ("maxPerOrder" > 0)
);
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_categoryId_isActive_idx" ON "products"("categoryId","isActive");
CREATE INDEX "products_gameId_isActive_idx" ON "products"("gameId","isActive");
CREATE INDEX "products_type_isActive_idx" ON "products"("type","isActive");
CREATE INDEX "products_isFeatured_idx" ON "products"("isFeatured");

CREATE TABLE "wallets" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"       UUID NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "balance"      DECIMAL(14,4) NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "wallets_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "wallets_balance_non_negative" CHECK ("balance" >= 0)
);
CREATE UNIQUE INDEX "wallets_userId_currencyCode_key" ON "wallets"("userId","currencyCode");
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

CREATE TABLE "product_prices" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId"    UUID NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "sellPrice"    DECIMAL(14,4) NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_prices_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "product_prices_non_negative" CHECK ("sellPrice" >= 0)
);
CREATE UNIQUE INDEX "product_prices_productId_currencyCode_key" ON "product_prices"("productId","currencyCode");
CREATE INDEX "product_prices_currencyCode_idx" ON "product_prices"("currencyCode");

CREATE TABLE "banners" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "titleAr"   TEXT NOT NULL,
  "titleEn"   TEXT NOT NULL,
  "imageUrl"  TEXT NOT NULL,
  "linkType"  TEXT,
  "linkValue" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "startsAt"  TIMESTAMP(3),
  "endsAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "banners_isActive_sortOrder_idx" ON "banners"("isActive","sortOrder");

-- ─────────────── Providers ───────────────

CREATE TABLE "providers" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"              TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "baseUrl"           TEXT NOT NULL,
  "apiKeyEnc"         TEXT NOT NULL,
  "apiSecretEnc"      TEXT,
  "extraConfig"       JSONB,
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "priority"          INTEGER NOT NULL DEFAULT 0,
  "balance"           DECIMAL(14,4) NOT NULL DEFAULT 0,
  "lowBalanceAlert"   DECIMAL(14,4),
  "timeoutMs"         INTEGER NOT NULL DEFAULT 20000,
  "maxRetries"        INTEGER NOT NULL DEFAULT 2,
  "lastHealthCheckAt" TIMESTAMP(3),
  "isHealthy"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "providers_code_key" ON "providers"("code");
CREATE INDEX "providers_isActive_priority_idx" ON "providers"("isActive","priority");

CREATE TABLE "product_providers" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId"    UUID NOT NULL,
  "providerId"   UUID NOT NULL,
  "providerSku"  TEXT NOT NULL,
  "providerCost" DECIMAL(14,4) NOT NULL,
  "priority"     INTEGER NOT NULL DEFAULT 0,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "product_providers_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_providers_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE,
  CONSTRAINT "product_providers_cost_non_negative" CHECK ("providerCost" >= 0)
);
CREATE UNIQUE INDEX "product_providers_productId_providerId_key" ON "product_providers"("productId","providerId");
CREATE UNIQUE INDEX "product_providers_providerId_providerSku_key" ON "product_providers"("providerId","providerSku");
CREATE INDEX "product_providers_productId_priority_idx" ON "product_providers"("productId","priority");

-- ─────────────── Orders ───────────────

CREATE TABLE "coupons" (
  "code"           TEXT NOT NULL,
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "discountType"   "DiscountType" NOT NULL,
  "discountValue"  DECIMAL(14,4) NOT NULL,
  "maxDiscount"    DECIMAL(14,4),
  "minOrderTotal"  DECIMAL(14,4),
  "currency"       CHAR(3),
  "maxUses"        INTEGER,
  "maxUsesPerUser" INTEGER DEFAULT 1,
  "usedCount"      INTEGER NOT NULL DEFAULT 0,
  "startsAt"       TIMESTAMP(3),
  "expiresAt"      TIMESTAMP(3),
  "isActive"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "coupons_value_positive" CHECK ("discountValue" > 0),
  CONSTRAINT "coupons_percent_range" CHECK ("discountType" <> 'PERCENT' OR "discountValue" <= 100),
  CONSTRAINT "coupons_window_valid" CHECK ("startsAt" IS NULL OR "expiresAt" IS NULL OR "startsAt" < "expiresAt")
);
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");
CREATE INDEX "coupons_isActive_expiresAt_idx" ON "coupons"("isActive","expiresAt");

CREATE TABLE "orders" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderNumber"    TEXT NOT NULL,
  "userId"         UUID NOT NULL,
  "status"         "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "subtotal"       DECIMAL(14,4) NOT NULL,
  "discount"       DECIMAL(14,4) NOT NULL DEFAULT 0,
  "fees"           DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxAmount"      DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxRate"        DECIMAL(6,4),
  "taxInclusive"   BOOLEAN NOT NULL DEFAULT false,
  "total"          DECIMAL(14,4) NOT NULL,
  "currency"       CHAR(3) NOT NULL,
  "baseCurrency"   CHAR(3) NOT NULL,
  "fxRate"         DECIMAL(20,10) NOT NULL,
  "totalBase"      DECIMAL(14,4) NOT NULL,
  "fxRateId"       UUID,
  "couponId"       UUID,
  "idempotencyKey" TEXT,
  "ipAddress"      TEXT,
  "userAgent"      TEXT,
  "notes"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "paidAt"         TIMESTAMP(3),
  "completedAt"    TIMESTAMP(3),
  CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL,
  CONSTRAINT "orders_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "orders_baseCurrency_fkey" FOREIGN KEY ("baseCurrency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "orders_fxRateId_fkey" FOREIGN KEY ("fxRateId") REFERENCES "fx_rates"("id") ON DELETE SET NULL,
  CONSTRAINT "orders_amounts_non_negative" CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "fees" >= 0 AND "taxAmount" >= 0 AND "total" >= 0),
  -- taxAmount is 0 in MVP, so this reduces to the pre-VAT formula
  CONSTRAINT "orders_total_consistent" CHECK ("total" = "subtotal" - "discount" + "fees" + "taxAmount"),
  CONSTRAINT "orders_fxRate_positive" CHECK ("fxRate" > 0)
);
CREATE UNIQUE INDEX "orders_orderNumber_key" ON "orders"("orderNumber");
CREATE UNIQUE INDEX "orders_idempotencyKey_key" ON "orders"("idempotencyKey");
CREATE INDEX "orders_userId_status_idx" ON "orders"("userId","status");
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status","createdAt");
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");

CREATE TABLE "order_items" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"               UUID NOT NULL,
  "productId"             UUID NOT NULL,
  "productNameAr"         TEXT NOT NULL,
  "productNameEn"         TEXT NOT NULL,
  "quantity"              INTEGER NOT NULL DEFAULT 1,
  "unitPrice"             DECIMAL(14,4) NOT NULL,
  "unitCost"              DECIMAL(14,4) NOT NULL,
  "lineTotal"             DECIMAL(14,4) NOT NULL,
  "taxAmount"             DECIMAL(14,4) NOT NULL DEFAULT 0,
  "taxRate"               DECIMAL(6,4),
  "status"                "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
  "fulfilledByProviderId" UUID,
  "attemptCount"          INTEGER NOT NULL DEFAULT 0,
  "lastError"             TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  "deliveredAt"           TIMESTAMP(3),
  CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE,
  CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT,
  CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "order_items_line_total_consistent" CHECK ("lineTotal" = "unitPrice" * "quantity")
);
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");
CREATE INDEX "order_items_status_idx" ON "order_items"("status");
CREATE INDEX "order_items_productId_idx" ON "order_items"("productId");

CREATE TABLE "order_inputs" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderItemId" UUID NOT NULL,
  "fieldKey"    TEXT NOT NULL,
  "fieldLabel"  TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "isSensitive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_inputs_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "order_inputs_orderItemId_fieldKey_key" ON "order_inputs"("orderItemId","fieldKey");

CREATE TABLE "order_results" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderItemId" UUID NOT NULL,
  "resultType"  TEXT NOT NULL,
  "valueEnc"    TEXT NOT NULL,
  "providerRef" TEXT,
  "viewedAt"    TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_results_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE
);
CREATE INDEX "order_results_orderItemId_idx" ON "order_results"("orderItemId");

CREATE TABLE "product_codes" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "productId"   UUID NOT NULL,
  "codeEnc"     TEXT NOT NULL,
  "serialEnc"   TEXT,
  "batchRef"    TEXT,
  "expiresAt"   TIMESTAMP(3),
  "isUsed"      BOOLEAN NOT NULL DEFAULT false,
  "usedAt"      TIMESTAMP(3),
  "orderItemId" UUID,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE,
  CONSTRAINT "product_codes_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL,
  CONSTRAINT "product_codes_used_has_item" CHECK (NOT "isUsed" OR "orderItemId" IS NOT NULL)
);
CREATE UNIQUE INDEX "product_codes_orderItemId_key" ON "product_codes"("orderItemId");
CREATE INDEX "product_codes_productId_isUsed_idx" ON "product_codes"("productId","isUsed");
CREATE INDEX "product_codes_expiresAt_idx" ON "product_codes"("expiresAt");

CREATE TABLE "provider_calls" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "providerId"     UUID NOT NULL,
  "orderItemId"    UUID,
  "endpoint"       TEXT NOT NULL,
  "httpMethod"     TEXT NOT NULL DEFAULT 'POST',
  "idempotencyKey" TEXT,
  "requestBody"    JSONB NOT NULL,
  "responseBody"   JSONB,
  "httpStatus"     INTEGER,
  "success"        BOOLEAN NOT NULL DEFAULT false,
  "errorCode"      TEXT,
  "errorMessage"   TEXT,
  "attemptNo"      INTEGER NOT NULL DEFAULT 1,
  "durationMs"     INTEGER,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_calls_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE RESTRICT,
  CONSTRAINT "provider_calls_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "provider_calls_idempotencyKey_key" ON "provider_calls"("idempotencyKey");
CREATE INDEX "provider_calls_orderItemId_idx" ON "provider_calls"("orderItemId");
CREATE INDEX "provider_calls_providerId_createdAt_idx" ON "provider_calls"("providerId","createdAt");
CREATE INDEX "provider_calls_success_createdAt_idx" ON "provider_calls"("success","createdAt");

-- ─────────────── Payments ───────────────

CREATE TABLE "payments" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"        UUID NOT NULL,
  "userId"         UUID NOT NULL,
  "gateway"        "PaymentGateway" NOT NULL,
  "gatewayRef"     TEXT,
  "amount"         DECIMAL(14,4) NOT NULL,
  "currency"       CHAR(3) NOT NULL,
  "baseCurrency"   CHAR(3) NOT NULL,
  "fxRate"         DECIMAL(20,10) NOT NULL,
  "amountBase"     DECIMAL(14,4) NOT NULL,
  "fxRateId"       UUID,
  "status"         "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
  "refundedAmount" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "cardBrand"      TEXT,
  "cardLast4"      VARCHAR(4),
  "rawResponse"    JSONB,
  "failureCode"    TEXT,
  "failureReason"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  "capturedAt"     TIMESTAMP(3),
  CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "payments_currency_fkey" FOREIGN KEY ("currency") REFERENCES "currencies"("code") ON DELETE RESTRICT,
  CONSTRAINT "payments_fxRateId_fkey" FOREIGN KEY ("fxRateId") REFERENCES "fx_rates"("id") ON DELETE SET NULL,
  CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "payments_fxRate_positive" CHECK ("fxRate" > 0),
  CONSTRAINT "payments_refund_within_amount" CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount")
);
CREATE UNIQUE INDEX "payments_gatewayRef_key" ON "payments"("gatewayRef");
CREATE INDEX "payments_orderId_idx" ON "payments"("orderId");
CREATE INDEX "payments_userId_status_idx" ON "payments"("userId","status");
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status","createdAt");

CREATE TABLE "refunds" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "orderId"       UUID NOT NULL,
  "paymentId"     UUID,
  "amount"        DECIMAL(14,4) NOT NULL,
  "currency"      CHAR(3) NOT NULL,
  "fxRate"        DECIMAL(20,10) NOT NULL,
  "amountBase"    DECIMAL(14,4) NOT NULL,
  "reason"        TEXT NOT NULL,
  "status"        "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
  "gatewayRef"    TEXT,
  "toWallet"      BOOLEAN NOT NULL DEFAULT false,
  "requestedById" UUID NOT NULL,
  "processedById" UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "processedAt"   TIMESTAMP(3),
  CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL,
  CONSTRAINT "refunds_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "refunds_processedById_fkey" FOREIGN KEY ("processedById") REFERENCES "users"("id") ON DELETE SET NULL,
  CONSTRAINT "refunds_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");
CREATE INDEX "refunds_status_createdAt_idx" ON "refunds"("status","createdAt");

CREATE TABLE "wallet_transactions" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "walletId"      UUID NOT NULL,
  "userId"        UUID NOT NULL,
  "type"          "WalletTxnType" NOT NULL,
  "amount"        DECIMAL(14,4) NOT NULL,
  "balanceBefore" DECIMAL(14,4) NOT NULL,
  "balanceAfter"  DECIMAL(14,4) NOT NULL,
  "currency"      CHAR(3) NOT NULL,
  "referenceType" TEXT,
  "referenceId"   UUID,
  "description"   TEXT,
  "createdById"   UUID,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_transactions_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE,
  CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "wallet_transactions_ledger_consistent" CHECK ("balanceAfter" = "balanceBefore" + "amount"),
  CONSTRAINT "wallet_transactions_balance_non_negative" CHECK ("balanceAfter" >= 0)
);
CREATE INDEX "wallet_transactions_walletId_createdAt_idx" ON "wallet_transactions"("walletId","createdAt");
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId","createdAt");
CREATE INDEX "wallet_transactions_referenceType_referenceId_idx" ON "wallet_transactions"("referenceType","referenceId");

-- ─────────────── System ───────────────

CREATE TABLE "notifications" (
  "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"    UUID NOT NULL,
  "channel"   "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
  "titleAr"   TEXT NOT NULL,
  "titleEn"   TEXT NOT NULL,
  "bodyAr"    TEXT NOT NULL,
  "bodyEn"    TEXT NOT NULL,
  "data"      JSONB,
  "isRead"    BOOLEAN NOT NULL DEFAULT false,
  "readAt"    TIMESTAMP(3),
  "sentAt"    TIMESTAMP(3),
  "error"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId","isRead");
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

CREATE TABLE "audit_logs" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"     UUID,
  "action"     TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT,
  "before"     JSONB,
  "after"      JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType","entityId");
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId","createdAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

CREATE TABLE "system_settings" (
  "key"         TEXT PRIMARY KEY,
  "value"       JSONB NOT NULL,
  "group"       TEXT NOT NULL DEFAULT 'general',
  "description" TEXT,
  "isPublic"    BOOLEAN NOT NULL DEFAULT false,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE INDEX "system_settings_group_idx" ON "system_settings"("group");

-- ─────────────── Partial indexes (hot paths) ───────────────

-- only active catalog rows are ever browsed
CREATE INDEX "products_active_only_idx" ON "products"("categoryId","sortOrder") WHERE "deletedAt" IS NULL AND "isActive" = true;
-- the fulfilment worker only ever scans unfinished items
CREATE INDEX "order_items_pending_idx" ON "order_items"("createdAt") WHERE "status" IN ('PENDING','PROCESSING');
-- code allocation always looks for free codes
CREATE INDEX "product_codes_available_idx" ON "product_codes"("productId") WHERE "isUsed" = false;
