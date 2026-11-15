-- The store owner sets discounts per product, and the price customers see is
-- exactly the price the owner enters.
--
-- Hand-written on purpose: `prisma migrate dev` would also emit the whole
-- operational layer (BRIN/trigram/keyset indexes, DB-side id defaults, FK
-- actions) as drift, which the migrations intentionally keep (ADR 020).

-- 1) Owner-set discount, whole percent (0-90, validated in the DTO). NULL = none.
ALTER TABLE "products" ADD COLUMN "discountPercent" INTEGER;

-- 2) No FX markup by default. (PricingService also never applies it to the
--    base currency, where nothing is converted.)
UPDATE "system_settings"
SET "value" = '0'::jsonb, "updatedAt" = NOW()
WHERE "key" = 'currency.fx_markup_percent';

-- 3) Discounts are the owner's per-product choice: retire the sample coupon.
UPDATE "coupons"
SET "isActive" = false, "updatedAt" = NOW()
WHERE "code" = 'WELCOME10';
