-- Customers sign in with their WhatsApp number; the store owner relays
-- verification codes over WhatsApp by hand.
--
-- Hand-written, like the other recent migrations: `prisma migrate dev` would
-- also emit the operational layer (ADR 020) as drift.

-- 1) A phone-only account has neither an email nor a password. Staff and
--    earlier customers keep theirs. (A unique index admits many NULLs.)
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- 2) Signing in to an already-verified number needs a code.
ALTER TYPE "VerificationPurpose" ADD VALUE 'PHONE_LOGIN';

-- 3) A code the owner relays must be readable by them: kept encrypted (AES-GCM,
--    ENCRYPTION_KEY) beside its hash, with when they sent it.
ALTER TABLE "verification_tokens" ADD COLUMN "codeEnc" TEXT;
ALTER TABLE "verification_tokens" ADD COLUMN "sentAt" TIMESTAMP(3);
