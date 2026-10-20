-- Platform V2: accounts (passkeys, sessions, support-assisted recovery), USDT
-- orders, agents and commissions, the staff notification inbox, bank
-- notifications read by the owner's Android phone, and the backup log.
--
-- Only new tables, new nullable columns and new enum values: nothing existing
-- is changed or removed, so the running version keeps working beside it.
-- Generated with `prisma migrate diff` from the previous schema.

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "UsdtNetwork" AS ENUM ('TRC20', 'BEP20', 'ERC20');

-- CreateEnum
CREATE TYPE "UsdtDelivery" AS ENUM ('ONCHAIN', 'BINANCE');

-- CreateEnum
CREATE TYPE "UsdtOrderStatus" AS ENUM ('NEW', 'AWAITING_PAYMENT', 'UNDER_REVIEW', 'READY_TO_SEND', 'COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'EARNED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "StaffPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "BankNoticeStatus" AS ENUM ('NEW', 'SUGGESTED', 'CONFIRMED', 'IGNORED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "VerificationPurpose" ADD VALUE 'ACCOUNT_RECOVERY';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referredByAgentId" UUID;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "sessionId" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "agentId" UUID;

-- CreateTable
CREATE TABLE "passkeys" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceName" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "purpose" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_recovery_requests" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "contact" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "proof" TEXT NOT NULL,
    "newContact" TEXT,
    "status" "RecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_recovery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usdt_orders" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "status" "UsdtOrderStatus" NOT NULL DEFAULT 'NEW',
    "amountUsdt" DECIMAL(18,6) NOT NULL,
    "delivery" "UsdtDelivery" NOT NULL,
    "network" "UsdtNetwork",
    "address" TEXT,
    "binanceId" TEXT,
    "rate" DECIMAL(18,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "fee" DECIMAL(18,4) NOT NULL,
    "total" DECIMAL(18,4) NOT NULL,
    "paymentMethod" TEXT,
    "payerPhone" TEXT,
    "paymentRef" TEXT,
    "proofUploadId" UUID,
    "txid" TEXT,
    "rejectReason" TEXT,
    "reviewedById" UUID,
    "idempotencyKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usdt_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usdt_order_events" (
    "id" UUID NOT NULL,
    "usdtOrderId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "fromStatus" "UsdtOrderStatus",
    "toStatus" "UsdtOrderStatus",
    "note" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usdt_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "commissionValue" DECIMAL(14,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "basis" DECIMAL(14,4) NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "rule" JSONB NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "payoutId" UUID,
    "voidReason" TEXT,
    "earnedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_payouts" (
    "id" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paidById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_notifications" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "priority" "StaffPriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "readAt" TIMESTAMP(3),
    "readById" UUID,
    "resolvedAt" TIMESTAMP(3),
    "remindCount" INTEGER NOT NULL DEFAULT 0,
    "lastRemindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_notification_prefs" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "muted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "staff_notification_prefs_pkey" PRIMARY KEY ("userId","type")
);

-- CreateTable
CREATE TABLE "bank_notifications" (
    "id" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sourceApp" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" DECIMAL(18,4),
    "currency" CHAR(3),
    "reference" TEXT,
    "sender" TEXT,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "parser" TEXT NOT NULL,
    "status" "BankNoticeStatus" NOT NULL DEFAULT 'NEW',
    "fingerprint" TEXT NOT NULL,
    "duplicateOfId" UUID,
    "suggestedPaymentId" UUID,
    "matchedPaymentId" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "bank_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL,
    "trigger" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "remoteId" TEXT,
    "counts" JSONB,
    "error" TEXT,
    "triggeredById" UUID,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passkeys_credentialId_key" ON "passkeys"("credentialId");

-- CreateIndex
CREATE INDEX "passkeys_userId_idx" ON "passkeys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_challenges_challenge_key" ON "webauthn_challenges"("challenge");

-- CreateIndex
CREATE INDEX "webauthn_challenges_expiresAt_idx" ON "webauthn_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "account_recovery_requests_status_createdAt_idx" ON "account_recovery_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "account_recovery_requests_userId_idx" ON "account_recovery_requests"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usdt_orders_number_key" ON "usdt_orders"("number");

-- CreateIndex
CREATE UNIQUE INDEX "usdt_orders_txid_key" ON "usdt_orders"("txid");

-- CreateIndex
CREATE UNIQUE INDEX "usdt_orders_idempotencyKey_key" ON "usdt_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "usdt_orders_userId_createdAt_idx" ON "usdt_orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "usdt_orders_status_createdAt_idx" ON "usdt_orders"("status", "createdAt");

-- CreateIndex
CREATE INDEX "usdt_order_events_usdtOrderId_createdAt_idx" ON "usdt_order_events"("usdtOrderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "agents_userId_key" ON "agents"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_code_key" ON "agents"("code");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_orderId_key" ON "commissions"("orderId");

-- CreateIndex
CREATE INDEX "commissions_agentId_status_idx" ON "commissions"("agentId", "status");

-- CreateIndex
CREATE INDEX "agent_payouts_agentId_createdAt_idx" ON "agent_payouts"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_notifications_dedupeKey_key" ON "staff_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "staff_notifications_resolvedAt_priority_createdAt_idx" ON "staff_notifications"("resolvedAt", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "staff_notifications_type_createdAt_idx" ON "staff_notifications"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_notifications_fingerprint_key" ON "bank_notifications"("fingerprint");

-- CreateIndex
CREATE INDEX "bank_notifications_status_receivedAt_idx" ON "bank_notifications"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "bank_notifications_reference_idx" ON "bank_notifications"("reference");

-- CreateIndex
CREATE INDEX "backup_runs_startedAt_idx" ON "backup_runs"("startedAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredByAgentId_fkey" FOREIGN KEY ("referredByAgentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_recovery_requests" ADD CONSTRAINT "account_recovery_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usdt_orders" ADD CONSTRAINT "usdt_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usdt_orders" ADD CONSTRAINT "usdt_orders_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usdt_order_events" ADD CONSTRAINT "usdt_order_events_usdtOrderId_fkey" FOREIGN KEY ("usdtOrderId") REFERENCES "usdt_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "agent_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_payouts" ADD CONSTRAINT "agent_payouts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- New permissions (production does not re-run the seed). super_admin needs no
-- rows: it bypasses the matrix. The agent role sees only its own account.
INSERT INTO "permissions" ("key", "module", "description") VALUES
  ('usdt.read', 'usdt', 'View USDT orders'),
  ('usdt.manage', 'usdt', 'Review, approve, send and reject USDT orders'),
  ('agents.manage', 'agents', 'Manage agents, commission rules and payouts'),
  ('agents.self', 'agents', 'An agent: see their own referrals and commissions'),
  ('staff.notifications', 'system', 'Read the staff notification inbox'),
  ('bank.review', 'payments', 'Review bank notifications read by the admin phone'),
  ('backup.manage', 'system', 'Download, schedule and verify backups'),
  ('recovery.review', 'users', 'Review account recovery requests')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "roles" ("name", "description", "isSystem", "updatedAt")
VALUES ('agent', 'Referral agent (مندوب): own referrals and commissions only', true, CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r JOIN "permissions" p ON
  (r."name" = 'admin' AND p."key" IN ('usdt.read', 'usdt.manage', 'agents.manage', 'staff.notifications', 'bank.review', 'recovery.review'))
  OR (r."name" = 'finance' AND p."key" IN ('usdt.read', 'staff.notifications', 'bank.review'))
  OR (r."name" = 'support' AND p."key" IN ('staff.notifications', 'recovery.review'))
  OR (r."name" = 'agent' AND p."key" = 'agents.self')
ON CONFLICT DO NOTHING;
