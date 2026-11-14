-- Agents: a refund after a commission was paid out is recorded as a visible
-- clawback on that commission (the paid amount itself is never rewritten), and
-- a payout records how much of the agent's open clawbacks it deducted.
-- Additive only: new nullable columns.

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "clawbackAmount" DECIMAL(14,4),
ADD COLUMN     "clawbackAt" TIMESTAMP(3),
ADD COLUMN     "clawbackReason" TEXT,
ADD COLUMN     "clawbackRecovered" DECIMAL(14,4);

-- AlterTable
ALTER TABLE "agent_payouts" ADD COLUMN     "clawbackDeducted" DECIMAL(14,4);
