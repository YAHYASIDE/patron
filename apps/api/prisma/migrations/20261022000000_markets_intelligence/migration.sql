-- Markets and intelligence: per-country settings (currency, languages, payment
-- methods found by research, product availability) and the discovery engine
-- (discoveries with a decision log, agent runs). Additive only.
-- Generated with `prisma migrate diff` from the previous schema.

-- CreateEnum
CREATE TYPE "MarketReviewStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "ProductAvailability" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'REGION_ACCOUNT_REQUIRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('NEW', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'DEFERRED', 'IN_PROGRESS', 'DONE');

-- CreateEnum
CREATE TYPE "DiscoverySeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateTable
CREATE TABLE "market_countries" (
    "code" CHAR(2) NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameFr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "currencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dialCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastResearchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "market_payment_methods" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT,
    "kind" TEXT NOT NULL,
    "currency" CHAR(3),
    "fees" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" "MarketReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "verifiedBy" TEXT NOT NULL,
    "accountId" TEXT,
    "decisionById" UUID,
    "decisionAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_market_rules" (
    "id" UUID NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "scope" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "availability" "ProductAvailability" NOT NULL DEFAULT 'UNKNOWN',
    "note" TEXT,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "status" "MarketReviewStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "verifiedBy" TEXT NOT NULL,
    "decisionById" UUID,
    "decisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_market_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discoveries" (
    "id" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "severity" "DiscoverySeverity" NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT NOT NULL,
    "proposal" TEXT NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT NOT NULL,
    "testResults" JSONB,
    "branch" TEXT,
    "prUrl" TEXT,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deferredUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_decisions" (
    "id" UUID NOT NULL,
    "discoveryId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "actorId" UUID,
    "actorLabel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT,
    "discoveries" INTEGER NOT NULL DEFAULT 0,
    "testsPassed" INTEGER,
    "testsFailed" INTEGER,
    "commit" TEXT,
    "branch" TEXT,
    "details" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_payment_methods_status_idx" ON "market_payment_methods"("status");

-- CreateIndex
CREATE UNIQUE INDEX "market_payment_methods_countryCode_key_key" ON "market_payment_methods"("countryCode", "key");

-- CreateIndex
CREATE INDEX "product_market_rules_status_idx" ON "product_market_rules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_market_rules_countryCode_scope_ref_key" ON "product_market_rules"("countryCode", "scope", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "discoveries_fingerprint_key" ON "discoveries"("fingerprint");

-- CreateIndex
CREATE INDEX "discoveries_status_severity_idx" ON "discoveries"("status", "severity");

-- CreateIndex
CREATE INDEX "discoveries_kind_status_idx" ON "discoveries"("kind", "status");

-- CreateIndex
CREATE INDEX "discovery_decisions_discoveryId_createdAt_idx" ON "discovery_decisions"("discoveryId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_agent_startedAt_idx" ON "agent_runs"("agent", "startedAt");

-- AddForeignKey
ALTER TABLE "market_payment_methods" ADD CONSTRAINT "market_payment_methods_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "market_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_market_rules" ADD CONSTRAINT "product_market_rules_countryCode_fkey" FOREIGN KEY ("countryCode") REFERENCES "market_countries"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_decisions" ADD CONSTRAINT "discovery_decisions_discoveryId_fkey" FOREIGN KEY ("discoveryId") REFERENCES "discoveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The countries the store already serves (its regions), as they are today; Senegal is
-- added switched off, as an example of a country being studied.
INSERT INTO "market_countries" ("code", "nameAr", "nameFr", "nameEn", "currency", "currencies", "languages", "dialCode", "enabled", "updatedAt") VALUES
  ('MR', 'موريتانيا', 'Mauritanie', 'Mauritania', 'MRU', ARRAY['MRU'], ARRAY['ar', 'fr'], '222', true, CURRENT_TIMESTAMP),
  ('ML', 'مالي', 'Mali', 'Mali', 'XOF', ARRAY['XOF', 'USD'], ARRAY['fr'], '223', true, CURRENT_TIMESTAMP),
  ('DZ', 'الجزائر', 'Algérie', 'Algeria', 'DZD', ARRAY['DZD', 'USD'], ARRAY['ar', 'fr'], '213', true, CURRENT_TIMESTAMP),
  ('NE', 'النيجر', 'Niger', 'Niger', 'XOF', ARRAY['XOF', 'USD'], ARRAY['fr'], '227', true, CURRENT_TIMESTAMP),
  ('SN', 'السنغال', 'Sénégal', 'Senegal', 'XOF', ARRAY['XOF'], ARRAY['fr', 'wo'], '221', false, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('markets.manage', 'markets', 'Manage countries, payment-method suggestions and product availability'),
  ('intelligence.read', 'intelligence', 'Read the intelligence and development center'),
  ('intelligence.decide', 'intelligence', 'Approve, reject or defer discoveries and suggestions')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON
  (r."name" = 'admin' AND p."key" IN ('markets.manage', 'intelligence.read', 'intelligence.decide'))
  OR (r."name" IN ('finance', 'support') AND p."key" = 'intelligence.read')
ON CONFLICT DO NOTHING;
