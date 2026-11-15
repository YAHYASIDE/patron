-- «أسلّمه بنفسي» (I deliver it myself): a MANUAL product the owner fulfils by
-- hand stays orderable without a supplier link or code stock. Additive.
ALTER TABLE "products" ADD COLUMN "selfDelivery" BOOLEAN NOT NULL DEFAULT false;

-- Mauritanian airtime and crypto transfers the owner sends himself.
UPDATE "products" SET "selfDelivery" = true
WHERE "sku" LIKE 'TOP-MATTEL-%'
   OR "sku" LIKE 'TOP-MAURITEL-%'
   OR "sku" LIKE 'TOP-CHINGUITEL-%'
   OR "sku" LIKE 'CRYPTO-USDT-%'
   OR "sku" LIKE 'CRYPTO-KAST-%'
   OR "sku" LIKE 'CRYPTO-REDOTPAY-%';
