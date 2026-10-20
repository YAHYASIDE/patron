-- Codes the owner uploads in advance (iTunes, PUBG, ...) are delivered as soon
-- as an order is paid.

-- 1) An order item of quantity 2 takes two codes: the item link is no longer
--    one-to-one.
DROP INDEX "product_codes_orderItemId_key";
CREATE INDEX "product_codes_orderItemId_idx" ON "product_codes"("orderItemId");

-- 2) The same code must never be stocked (and sold) twice: a SHA-256 of the
--    normalised code, unique. NULL for rows from before this column.
ALTER TABLE "product_codes" ADD COLUMN "codeHash" TEXT;
CREATE UNIQUE INDEX "product_codes_codeHash_key" ON "product_codes"("codeHash");
