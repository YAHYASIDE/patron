-- Uploaded files (transfer receipts, payment-method logos, banner images),
-- stored in the database because the host keeps no disk across deploys.
CREATE TABLE "uploads" (
  "id"        UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind"      TEXT NOT NULL,
  "mime"      TEXT NOT NULL,
  "size"      INTEGER NOT NULL,
  "data"      BYTEA NOT NULL,
  "isPublic"  BOOLEAN NOT NULL DEFAULT false,
  "userId"    UUID,
  "paymentId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "uploads_paymentId_idx" ON "uploads"("paymentId");
