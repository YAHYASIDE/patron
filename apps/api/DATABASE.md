# Patron — Database Layer (v1.0, for review)

## Files
| File | Purpose |
|---|---|
| `prisma/schema.prisma` | Full data model — 24 models, 12 enums |
| `prisma/migrations/20260720000000_init/migration.sql` | Initial DDL incl. CHECK constraints and partial indexes |
| `prisma/seed.ts` | Idempotent seed: permissions, roles, super admin, catalog, providers, settings |

## Running it

```bash
npm i -D prisma ts-node typescript @types/node
npm i @prisma/client bcryptjs

cp .env.example .env        # fill DATABASE_URL, ENCRYPTION_KEY, SEED_ADMIN_PASSWORD
npx prisma migrate dev      # applies the init migration
npx prisma generate
npx prisma db seed
```

`ENCRYPTION_KEY` must be 64 hex chars: `openssl rand -hex 32`

> The migration SQL here was hand-written. Before committing, verify it matches the
> schema exactly: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $SHADOW_DB` — it should report no drift.

## Model inventory

**Identity & access (9)** — User, Role, Permission, UserRole, RolePermission, RefreshToken, VerificationToken, LoginAttempt, DeviceToken
**Catalog (5)** — Category, Game, Product, ProductCode, Banner
**Providers (3)** — Provider, ProductProvider, ProviderCall
**Orders (4)** — Order, OrderItem, OrderInput, OrderResult
**Money (4)** — Payment, Refund, WalletTransaction, Coupon
**System (4)** — Notification, AuditLog, Setting

## Decisions worth reviewing before I scaffold NestJS

1. **Price snapshots on `OrderItem`** — `unitPrice`, `unitCost` and product names are copied at checkout. Catalog edits never rewrite order history. Non-negotiable for accounting; flagging so you know the duplication is deliberate.

2. **`OrderStatus` vs `OrderItemStatus`** — separate enums. A multi-item order can be `PARTIALLY_COMPLETED` when one item is `DELIVERED` and another `FAILED`. The order status is derived from its items.

3. **Provider failover via `ProductProvider.priority`** — a product can map to both FazerCards and FoxReload. The engine walks them by priority, skipping unhealthy providers. `@@unique([providerId, providerSku])` prevents mapping the same provider SKU twice.

4. **`ProviderCall` logs every attempt**, not just failures — including `attemptNo` and `idempotencyKey`. Provider billing disputes are unwinnable without this. Secrets are redacted before persisting `requestBody`.

5. **Wallet is a ledger, not a counter** — `WalletTransaction` records `balanceBefore`/`balanceAfter`, with a CHECK enforcing `balanceAfter = balanceBefore + amount`. `User.walletBalance` is a cached projection; the ledger is the truth. All wallet writes must run in a transaction with `SELECT ... FOR UPDATE` on the user row.

6. **Encryption boundary** — `codeEnc`, `serialEnc`, `valueEnc` (delivered codes), `apiKeyEnc`/`apiSecretEnc`, `twoFaSecretEnc` are AES-256-GCM ciphertext. `OrderInput.value` is encrypted only when `isSensitive`. Card PAN/CVV are never stored, only `cardBrand` + `cardLast4`.

7. **Soft delete on `deletedAt`** applies to User, Category, Game, Product only. Orders, payments and logs are never deleted — regulatory.

8. **`Order.idempotencyKey`** is unique — protects against the double-tap that mobile clients reliably produce on flaky networks.

9. **CHECK constraints live in SQL, not Prisma** (Prisma has no CHECK support). If you later regenerate migrations from scratch, they'll be lost — keep this migration file.

## Open questions for you

- **Multi-currency?** Right now every table carries a `currency` column but the platform assumes SAR end-to-end. If you'll sell in USD/AED too, we need an `FxRate` table and a decision on whether prices are per-currency rows or converted at checkout. Cheaper to decide now than to retrofit.
- **VAT** — Saudi 15% VAT isn't modelled. Is Patron the merchant of record? If yes, `Order` needs `vatAmount` + `vatRate` and invoices need sequential numbering (ZATCA e-invoicing). This is the single biggest thing that could force a schema change later.
- **`ProductCode` stock** — `Product.stockQty` is `0` for CODE_POOL products in the seed. Should stock be derived from the code table (a count query) instead of stored? Derived is correct but slower; stored needs a trigger to stay in sync.
- **Provider webhooks** — do FazerCards/FoxReload push async delivery callbacks? If so we need a `ProviderWebhook` table for replay protection.
