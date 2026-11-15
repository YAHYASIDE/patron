-- Retire the sample catalog that the bootstrap seed used to create, so a live
-- store never shows demo products with placeholder prices. Data-only: no
-- structural change, so schema.prisma is untouched.
--
-- Soft delete (deletedAt + isActive=false), matching ProductsService.remove:
-- order history that references these rows stays intact. On a database that
-- never had the demo rows (fresh dev/CI), this touches nothing.
UPDATE "products"
SET "deletedAt" = NOW(), "isActive" = false, "updatedAt" = NOW()
WHERE "sku" IN (
  'PUBG-UC-60',
  'PUBG-UC-325',
  'MLBB-DIA-86',
  'GC-ITUNES-50',
  'GC-PSN-100',
  'SUB-NETFLIX-1M',
  'LIC-WIN11-PRO'
)
AND "deletedAt" IS NULL;

-- Their placeholder provider routes go with them.
UPDATE "product_providers"
SET "isActive" = false, "updatedAt" = NOW()
WHERE "productId" IN (
  SELECT "id" FROM "products"
  WHERE "sku" IN (
    'PUBG-UC-60',
    'PUBG-UC-325',
    'MLBB-DIA-86',
    'GC-ITUNES-50',
    'GC-PSN-100',
    'SUB-NETFLIX-1M',
    'LIC-WIN11-PRO'
  )
);
