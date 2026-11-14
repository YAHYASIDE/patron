---
name: patron-product-manager
description: >-
  Manage Patron's catalogue: products, brands/games, categories, prices per currency,
  discounts, code stock, delivery types, visibility, catalog packs and product art.
  Use for "add/hide/reprice products", "المنتجات", "المخزون", "الأسعار", catalogue
  data fixes, or preparing a new catalog pack. Never deletes owner data; hides instead.
---

# Patron product manager

## Model (apps/api/prisma/schema.prisma)
Category → Game (brand, `inputSchema` = the account fields the customer types) → Product
(one per denomination; `sku`, `type`, `delivery` MANUAL | CODE_POOL | AUTO_PROVIDER,
`sellPrice`/`costPrice` in USD base, `discountPercent`, `isActive`, `metadata.guide`),
ProductPrice (fixed price per currency, e.g. MRU at face value), ProductCode (encrypted stock,
`codeHash` unique). Store groups products into brands (storefront/lib/brands.ts, sections.ts).

## Rules
- The owner curates from the dashboard; code never overwrites their edits. New products ship
  in a NEW catalog pack (`apps/api/src/bootstrap/catalog-pack.ts`, marker
  `catalog.pack.vN` in system_settings, insert-only, runs once on boot with CATALOG_PACK=true).
  Hiding is `isActive=false`, never delete.
- AUTO_PROVIDER products without a ready provider cannot be quoted (PRODUCT_UNAVAILABLE).
  CODE_POOL/MANUAL deliveries: codes pasted by the owner are delivered from stock first
  (`deliverFromStock`, FOR UPDATE SKIP LOCKED), the rest by hand.
- Prices: USD base; MRU overrides for local operators; FX rates in /currencies; a coupon that
  sells below cost shows in reports' losses. Never promise "instant delivery" for manual items.
- Product art: `apps/storefront/public/art/<sku>.svg` and `art/brand/<key>.svg`
  (`scripts/generate-product-art.mjs`).

## Procedures
- **Add products**: new pack vN with the SKUs, games (inputSchema with regex), prices and
  guides; unit test in `test/unit/catalog-pack.spec.ts`; regenerate art; owner reviews prices.
- **Bulk reprice**: admin BulkPrice / `PATCH /admin/catalog/products/:id`; check margins in
  /reports (below-cost alerts).
- **Stock**: `GET/POST/DELETE /admin/catalog/products/:id/codes` (codes.manage); the admin sees
  masked codes only.
- **Audit data**: `GET /catalog/products?limit=100&currency=MRU` (public) vs admin list;
  check hidden products are not in carts (tests/live/checkout-flow.mjs).

## Verify this skill worked
catalog-pack unit tests pass; a local stack with the pack applied shows the products in the
store at 390px with correct MRU prices; nothing the owner edited was overwritten.
