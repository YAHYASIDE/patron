# Patron — Database (Prisma Schema) Review

**Date:** 2026-07-22
**Schema:** `apps/api/prisma/schema.prisma` (1,138 lines) + 4 migrations
**Nature:** Read-only audit. **The schema was not modified.**

> Scope note: the Prisma DSL is only part of the picture. The migrations add a
> large amount of integrity that the schema file does not show — `CHECK`
> constraints, partial indexes, GIN/BRIN indexes, extended statistics,
> autovacuum tuning, and sequences. This review reads **both** the schema and
> the migration SQL, and is explicit about what is enforced **in the database**
> vs. only **in application code**.

**Headline:** this is a mature, defensively-designed schema. 40 models, 15
enums, **48 explicit referential actions** (no implicit defaults), money is
uniformly `Decimal`, and there is an unusually rich layer of DB-level
constraints and specialised indexes. The findings below are mostly refinements,
not defects.

---

## 1. All models (40)

| Domain | Models |
|---|---|
| Users & access | `User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `RefreshToken`, `VerificationToken`, `LoginAttempt`, `DeviceToken` |
| Catalog | `Category`, `Game`, `Product`, `ProductCode`, `Banner` |
| Providers | `Provider`, `ProductProvider`, `ProviderCall` |
| Orders | `Order`, `OrderItem`, `OrderInput`, `OrderResult` |
| Payments/Money | `Payment`, `Refund`, `WalletTransaction`, `Coupon`, `Wallet` |
| Currency/FX | `Currency`, `FxRate`, `ProductPrice` |
| Checkout | `CheckoutQuote`, `QuoteItem`, `QuoteItemInput` |
| System | `Notification`, `AuditLog`, `DailyRollup`, `SystemSetting` |
| Reliability | `OutboxEvent`, `IdempotencyRecord`, `InboundWebhook`, `NotificationTemplate` |

## 2. All enums (15)

`ProductType`, `DeliveryMode`, `OrderStatus`, `OrderItemStatus`,
`PaymentStatus`, `PaymentGateway`, `RefundStatus`, `DiscountType`,
`WalletTxnType`, `NotificationChannel`, `VerificationPurpose`, `QuoteStatus`,
`OutboxStatus`, `WebhookStatus`, `DevicePlatform`.

All status/lifecycle fields are enums (no free-text status columns). Good.

---

## 3. All relations

Key relationships (parent → children):

- **User** → roles, orders, quotes, payments, wallets, walletTransactions,
  notifications, devices, refreshTokens, verifications, auditLogs, refunds
  (requested/processed — two named relations).
- **Category** → self (`CategoryTree`), games, products.
- **Game** → products. **Product** → prices, quoteItems, providers, codes,
  orderItems.
- **Provider** → productProviders, calls. **ProductProvider** joins
  Product×Provider.
- **Order** → items, payments, refunds; belongs to user, coupon, fxRate, quote.
- **OrderItem** → inputs, results, providerCalls, assignedCode.
- **Payment** → refunds. **Refund** → order, payment, requester, processor.
- **Wallet** → transactions (per user × currency).
- **Currency** → fxRates (base/quote), productPrices, wallets.
- **CheckoutQuote** → items → inputs; 1:1 optional `Order`.

Two **named relations** are used correctly where a table references the same
parent twice: `Refund` → `User` as `RefundRequester`/`RefundProcessor`, and
`FxRate` → `Currency` as `FxBase`/`FxQuote`.

## 4. Cascade / delete behaviors

48 explicit actions — **no relation relies on the Prisma default.** Distribution:
**21 Cascade, 14 Restrict, 13 SetNull.**

| Action | Intent | Examples |
|---|---|---|
| **Cascade** | child cannot outlive parent | `UserRole`/`RolePermission` join rows; `OrderItem→Order`; `OrderInput`/`OrderResult→OrderItem`; `QuoteItem→CheckoutQuote`; `Wallet→User`; `WalletTransaction→Wallet`+`User`; `ProductCode→Product`; `ProductProvider→Product`/`Provider`; auth tokens → User |
| **Restrict** | protect financial/audit history | `Order→User`; `Payment→Order`/`User`; `Refund→Order`/requester; `ProviderCall→Provider`; `OrderItem→Product`; catalog `→Category`; FX/price/wallet `→Currency` |
| **SetNull** | keep the row, drop the link | `Category.parent`; `Product→Game`; `Order→FxRate`/`Coupon`/`Quote`; `Payment→FxRate`; `Refund→Payment`/processor; `AuditLog→User`; `ProductCode→OrderItem`; `CheckoutQuote→FxRate`/`Coupon` |

**Strengths:** money-bearing parents (`Order`, `Payment`, `Provider`) are
`Restrict`, so history can't be deleted out from under a financial record.
`SetNull` on snapshot FKs (`fxRateId`, `couponId`) is correct — the order keeps
its frozen `fxRate`/amounts even if the referenced rate/coupon is later removed.
`AuditLog→User SetNull` lets audit survive user deletion.

**Concerns** — see §15/§21:

- **`Wallet→User` and `WalletTransaction→User` are `Cascade`.** A user's wallet
  **ledger** is deleted with the user. Orders protect the user via `Restrict`,
  so a user *with orders* can't be hard-deleted — but a **wallet-only user**
  (top-up, no orders) can be, taking the financial ledger with them. This is
  weaker protection than the rest of the money model. (Users are meant to be
  soft-deleted, but the schema still permits the cascade.)
- **`ProductCode→OrderItem SetNull` vs. the CHECK `NOT isUsed OR orderItemId IS
  NOT NULL`.** If an `OrderItem` were ever deleted, `SetNull` would null the
  code's `orderItemId` while `isUsed` is still true, violating the CHECK and
  aborting the delete. In practice orders are never hard-deleted, so this is a
  latent conflict rather than a live bug — but the two rules contradict each
  other.

## 5. Unique constraints

**Field-level `@unique` (19):** `User.email`, `User.phone`, `Role.name`,
`Permission.key`, `RefreshToken.tokenHash`, `DeviceToken.token`,
`Category.slug`, `Game.slug`, `Product.sku`, `ProductCode.orderItemId`,
`Provider.code`, `ProviderCall.idempotencyKey`, `Order.orderNumber`,
`Order.quoteId`, `Order.idempotencyKey`, `Payment.gatewayRef`, `Coupon.code`,
`CheckoutQuote.quoteNumber`.

**Composite `@@unique` (8):** `ProductProvider(productId,providerId)` &
`(providerId,providerSku)`; `OrderInput(orderItemId,fieldKey)`;
`QuoteItemInput(quoteItemId,fieldKey)`; `FxRate(baseCurrency,quoteCurrency,effectiveAt)`;
`ProductPrice(productId,currencyCode)`; `Wallet(userId,currencyCode)`;
`InboundWebhook(source,eventId)`.

**DB-only partial unique (migration):**
`currencies_single_base_idx UNIQUE(isBase) WHERE isBase = true` — enforces
**exactly one base currency**. Excellent.

**Idempotency/replay guarantees** are anchored on uniques:
`Order.idempotencyKey`, `Payment.gatewayRef`, `ProviderCall.idempotencyKey`,
`InboundWebhook(source,eventId)`, `Order.quoteId` (one order per quote).

**Gap:** there is **no partial-unique for "one active FX rate per pair."**
`@@unique(base,quote,effectiveAt)` allows many `isActive=true` rows for the same
pair; "current rate" correctness relies on the app choosing the latest by
`effectiveAt`. See §13/§21.

## 6. Composite indexes

Representative composite/covering indexes (schema `@@index`): `User(deletedAt)`,
`Order(userId,status)`/`(status,createdAt)`, `OrderItem(orderId)`/`(status)`,
`Payment(userId,status)`/`(status,createdAt)`, `Wallet(userId,currencyCode)`,
`WalletTransaction(walletId,createdAt)`/`(userId,createdAt)`/`(referenceType,referenceId)`,
`FxRate(baseCurrency,quoteCurrency,isActive,effectiveAt)`,
`ProductProvider(productId,priority)`, `ProviderCall(providerId,createdAt)`/`(success,createdAt)`.

**DB-only specialised indexes (migrations) — a real strength:**

| Kind | Examples |
|---|---|
| **Partial** | active products; `order_items` pending/processing; available `product_codes`; active-quote expiry; outbox claim (`status=PENDING`); unread notifications; captured payments; failed provider calls; refresh tokens `WHERE revokedAt IS NULL` |
| **GIN (pg_trgm)** | `games(nameEn,nameAr)` and `orders(orderNumber)` — fuzzy/`contains` search |
| **BRIN** | append-only time series: `provider_calls`, `audit_logs`, `login_attempts` (kilobytes vs. GB btree) |
| **Keyset** | `orders(createdAt DESC,id DESC)` + user/status variants; `notifications(userId,createdAt DESC,id DESC)` — O(1)-depth cursor pagination |
| **Extended stats** | `CREATE STATISTICS ... (dependencies)` on `orders(status,paidAt)` and `order_items(status,deliveredAt)` |

Plus `SET STATISTICS 500` on skewed `status` columns and per-table autovacuum
tuning. This is well beyond typical.

## 7. Missing indexes

Because the migrations already cover the hot paths, the remaining gaps are
minor. **PostgreSQL does not auto-index foreign keys**, so these FK columns have
no supporting index (matters for reverse lookups and `SetNull`/`Cascade` delete
scans):

| Column | FK → | Impact |
|---|---|---|
| `Refund.paymentId` | Payment (SetNull) | "refunds for a payment" + null-out scan on payment delete |
| `Order.couponId` | Coupon (SetNull) | coupon usage/reporting; null-out on coupon delete |
| `Order.fxRateId` | FxRate (SetNull) | null-out scan if a rate row is deleted |
| `Payment.fxRateId` | FxRate (SetNull) | same |
| `Refund.requestedById` / `processedById` | User | "refunds by staff member" |
| `WalletTransaction.createdById` | (bare UUID, no FK) | admin-adjustment lookups |

None are on a documented hot path; the parents (Payment, Coupon, FxRate) are
rarely deleted, so this is low priority — but worth adding the `Refund.paymentId`
and `Order.couponId` indexes if those reverse queries appear.

## 8. Potential N+1 query risks

The service layer generally uses Prisma `include` (batched per-relation, not
per-row), so list endpoints are not classic N+1. The real fan-out is at **quote
pricing**:

- `QuotesService.create` → `Promise.all(items.map(priceItem))`, and each
  `priceItem` runs `product.findFirst` + `pricing.priceProduct` +
  `assertAvailable` (which itself does a `productCode.count` or
  `productProvider.count`). That is **~3 queries per line item** — bounded by
  cart size (small), but it grows linearly with items and could be batched
  (fetch all products/availability in one query).
- `OrdersService.findAllAdmin` includes `user`, `items`, `payments`: Prisma
  issues a handful of batched queries (fine), and the margin is computed over
  already-loaded items in memory (no extra queries).
- Reporting avoids N+1 entirely via set-based raw SQL.

**Verdict:** no severe N+1; the quote-pricing per-item fan-out is the one place
worth batching if large carts become common.

## 9. Decimal vs Integer usage

**Exemplary.** No floats anywhere. Money is `Decimal`; counts/quantities are
`Int`.

| Precision | Count | Use |
|---|---|---|
| `Decimal(14,4)` | 41 | per-row money (prices, amounts, balances) |
| `Decimal(18,4)` | 4 | rollup **aggregates** (`grossBase`, `discountBase`, `refundBase`, `costBase`) — wider to avoid sum overflow |
| `Decimal(20,10)` | 5 | `fxRate` (10 dp for accurate conversion) |
| `Decimal(6,4)` | 3 | `taxRate` |

**Notes:** `Decimal(14,4)` caps a single value at ~10 billion — fine per order,
and the widening to `(18,4)` for aggregates shows foresight. One subtlety:
amounts are stored at a fixed **4 dp regardless of the currency's own
`decimals`** (e.g. XOF = 0). Values remain correct, but **per-currency rounding
is an application responsibility** (the `Currency.decimals`/`roundingMode`/
`roundingStep` fields exist for exactly this) — the DB will happily store
`100.2500 XOF`.

## 10. UUID strategy

- All non-natural PKs are `String @id @default(uuid()) @db.Uuid` — stored as
  native 16-byte `uuid` (not `char(36)`), which is correct.
- **`uuid()` is UUID v4 (random), generated application-side.** Random PKs cause
  **index write amplification / page splits** on the highest-insert tables
  (`orders`, `order_items`, `provider_calls`, `audit_logs`). A time-ordered id
  (UUID v7 / ULID) would keep inserts append-friendly and improve BRIN/btree
  locality. `pgcrypto` is enabled but PK defaults don't use `gen_random_uuid()`.
- Natural keys are used where appropriate: `Currency.code` (Char(3)),
  `SystemSetting.key`, `NotificationTemplate.key`, `IdempotencyRecord.key`,
  and the composite PKs `UserRole`, `RolePermission`, `DailyRollup(day,currency)`.
- Human-facing identifiers (`orderNumber`, `quoteNumber`) moved to **sequences**
  in scale-hardening — monotonic and collision-free. Good.

**Suggestion:** consider UUID v7 for the append-heavy tables (see §21).

## 11. Soft delete strategy

`deletedAt` exists on **User, Category, Game, Product** only — i.e.
customer-visible catalog + account. Financial/event tables (`Order`, `Payment`,
`Refund`, `WalletTransaction`, `ProviderCall`, `AuditLog`) are **not**
soft-deleted, which is correct: those are immutable records governed by status
and retention, not deletion.

**Tensions to note:**

- **Soft delete + hard `@unique`.** `User.email`, `Product.sku`, `Category.slug`,
  `Game.slug` are plain uniques. A soft-deleted row **still occupies the unique
  namespace**, so the same email/SKU/slug cannot be reused after soft delete
  without either restoring the row or a partial unique
  (`UNIQUE(email) WHERE deletedAt IS NULL`). This is a common and consequential
  gotcha.
- **No global soft-delete filter in the DB.** Every query must remember
  `WHERE deletedAt IS NULL` (partial indexes like `products_active_only_idx`
  help, and the service layer does apply it — but it's convention, not enforced).

## 12. Audit fields consistency

- `createdAt @default(now())` is present essentially everywhere.
- `updatedAt @updatedAt` is present on all **mutable** entities and **absent on
  append-only/junction tables** (`WalletTransaction`, `ProviderCall`,
  `OrderResult`, `OrderInput`, `AuditLog`, `FxRate`, `OutboxEvent`,
  `InboundWebhook`, join rows, auth tokens, quote items). This absence is
  **intentional and correct** for immutable rows.
- Dedicated lifecycle timestamps are consistent and CHECK-guarded:
  `Order.paidAt/completedAt`, `Payment.capturedAt`, `Refund.processedAt`,
  `OrderItem.deliveredAt`, `DailyRollup.computedAt`.
- A dedicated **`AuditLog`** captures `action/entityType/entityId/before/after/
  ip/userAgent`.

**Minor:** immutability of the append-only tables (`WalletTransaction`,
`AuditLog`, `FxRate`, `OrderResult`, `ProviderCall`) is **by convention only** —
no trigger or revoked privilege prevents `UPDATE`/`DELETE`. For a ledger and an
audit log, DB-level append-only enforcement is worth considering (§21).

## 13. Multi-currency support

Comprehensive and well-modelled:

- `Currency` carries `decimals`, `roundingMode`, `roundingStep`, `isActive`, and
  `isBase` with a **partial-unique guaranteeing exactly one base**. CHECKs:
  `decimals BETWEEN 0 AND 4`, `roundingMode IN (...)`.
- `FxRate` is **append-only rate history** (`effectiveAt`, `expiresAt`,
  `isActive`, `source`) with CHECKs `rate > 0` and `baseCurrency <> quoteCurrency`.
- Every money aggregate snapshots the conversion: orders/payments/quotes/refunds
  each store `currency`, `baseCurrency`, `fxRate`, `fxRateId`, and a `*Base`
  amount, so historic figures are reproducible and the FK is `SetNull` (snapshot
  survives rate deletion).
- `Wallet` is **per user × currency** (`@@unique(userId,currencyCode)`); balances
  are never implicitly converted.
- `ProductPrice` allows a manual per-currency override; otherwise price is
  converted from base via the live rate.

**Gaps:** (a) no partial-unique for **one active rate per pair** (§5); (b)
per-currency rounding is app-enforced against a fixed 4-dp store (§9).

## 14. Provider-related tables

- **`Provider`** — secrets encrypted (`apiKeyEnc`, `apiSecretEnc`),
  `priority`, `isHealthy`, `timeoutMs`, `maxRetries`, `balance`,
  `lowBalanceAlert`; indexed `(isActive,priority)` for failover ordering.
- **`ProductProvider`** — Product×Provider mapping with `providerCost`,
  `priority`, and two uniques (`productId+providerId`, `providerId+providerSku`)
  plus `(productId,priority)` for failover selection. `providerCost >= 0` CHECK.
- **`ProviderCall`** — full outbound audit: `idempotencyKey @unique`,
  `requestBody`/`responseBody` (redacted), `httpStatus`, `success`, `errorCode`,
  `attemptNo`, `durationMs`; `Restrict` to Provider (can't delete a provider
  with call history — billing-dispute safe); BRIN on `createdAt` +
  partial failure index.

**Note:** `Provider.balance` is a **mutable scalar with no ledger** (unlike
`Wallet`). It mirrors provider-side balance and only drives a low-balance alert,
so double-entry isn't required — but be aware it has no transaction history.

## 15. Wallet ledger integrity

**Among the strongest parts of the schema.** DB-enforced:

- `wallet_transactions_ledger_consistent`: **`balanceAfter = balanceBefore +
  amount`** (signed amounts).
- `wallet_transactions_balance_non_negative`: `balanceAfter >= 0`.
- `wallets_balance_non_negative`: `balance >= 0`.
- `Wallet.version` optimistic lock; `@@unique(userId,currencyCode)`.
- Per-txn `balanceBefore`/`balanceAfter` snapshot + `type` + polymorphic
  `referenceType/referenceId` + indexes for reconciliation.
- A nightly reconciliation job (incremental, via `wallets_updated_idx`) checks
  drift.

**Gaps:**

1. No DB guarantee that **consecutive** ledger rows chain
   (`balanceBefore(n) = balanceAfter(n-1)`) or that `wallet.balance` equals the
   latest `balanceAfter` — enforced by app + optimistic lock + reconciliation,
   not by the DB.
2. Ledger rows are **not immutable at the DB level** (no anti-`UPDATE`/`DELETE`
   trigger).
3. **Cascade-deletable via `User`** (§4) — the one place financial history isn't
   `Restrict`-protected.

## 16. Order lifecycle integrity

Strong, with DB-level guards:

- `orders_total_consistent`: **`total = subtotal - discount + fees + taxAmount`**.
- `order_items_line_total_consistent`: **`lineTotal = unitPrice * quantity`**;
  `quantity > 0`; `unitCost >= 0`.
- `order_items_delivered_has_timestamp`: `DELIVERED ⇒ deliveredAt NOT NULL`.
- `orders_fxRate_positive`; amounts non-negative; `Order.version` optimistic
  lock; `Order.quoteId @unique` (one order per quote);
  `Order.idempotencyKey @unique`.
- Status is a derived state machine in the app (`assertTransition` /
  `deriveOrderStatus`).

**Notes:** status **transitions** are enforced only in the app (no DB trigger);
and the total-consistency CHECK assumes tax is additive — fine while
`taxInclusive` MVP tax is 0, but revisit the invariant when VAT and
`taxInclusive=true` are switched on.

## 17. Payment consistency

- `Payment.gatewayRef @unique` (idempotent capture), `amount > 0`, `fxRate > 0`,
  `payments_refund_within_amount` (**`0 <= refundedAmount <= amount`**),
  `payments_captured_has_timestamp` (`CAPTURED ⇒ capturedAt`), `version`,
  `amountBase` snapshot, `Restrict` to Order/User.
- Card data minimised: only `cardBrand` + `cardLast4 VarChar(4)`; "PAN/CVV never
  stored" (`rawResponse` redaction is app-enforced).

**Gap:** the DB permits **multiple payments per order** (correct — retries/
partial) but does **not** guarantee that the sum of captured `amountBase` equals
`order.totalBase`. That reconciliation is app-level only.

## 18. Refund flow

- `Refund` → Order (`Restrict`), Payment (`SetNull`); `amount > 0`; `amountBase`
  snapshot; `toWallet` flag; requester `Restrict` / processor `SetNull`;
  `refunds_processed_has_actor` (**`PROCESSED ⇒ processedById AND processedAt`**);
  `RefundStatus` lifecycle.
- Cumulative refunding is tracked on `Payment.refundedAmount` (bounded by the
  CHECK above).

**Gap:** no DB CHECK that `sum(refunds.amount for a payment) = payment.refundedAmount`
— the running column is app-maintained (the per-row CHECK caps it but doesn't
tie it to the refund rows).

## 19. Performance observations

**Positives** (mostly already implemented — see §6): partial indexes on hot
predicates, BRIN on append-only time series, GIN trigram for search, keyset
pagination indexes, extended statistics for correlated columns, raised
statistics targets on skewed status columns, per-table autovacuum tuning,
nightly rollups, and sequences for human ids.

**Watch items:**

1. **Random UUID v4 PKs** on `orders`/`order_items`/`provider_calls` cause btree
   write amplification at the modelled 1M-order scale (§10, §21).
2. **JSONB columns** (`Game.inputSchema`, `Product.metadata`,
   `*.payload/rawResponse/requestBody/headers`) are unindexed. Fine while
   they're read by id, but any `WHERE json ...` filter would seq-scan — add GIN
   only if such access appears.
3. `daily_rollups` appears to be created **both** by the Prisma model and by a
   raw `CREATE TABLE IF NOT EXISTS` in scale-hardening — harmless (idempotent)
   but redundant/confusing (§21).

## 20. Security observations

**Strengths:**

- Encryption at rest for secrets via `*Enc` columns: `twoFaSecretEnc`,
  `apiKeyEnc`/`apiSecretEnc`, `codeEnc`/`serialEnc`, `valueEnc` (order/quote
  inputs & results). Tokens are hashed, not stored raw (`tokenHash`,
  `codeHash`, SHA-256); `passwordHash` (bcrypt).
- Card data minimised (brand + last4 only).
- Replay/idempotency defenses at the DB layer (§5).

**Concerns:**

1. **PII stored in plaintext:** `email`, `phone`, `fullName`, `lastLoginIp`,
   `Order.ipAddress/userAgent`, `LoginAttempt.identifier`. Combined with
   **soft delete retaining rows**, GDPR/"right to erasure" needs a hard-delete
   or crypto-shred path — soft delete alone doesn't erase PII.
2. **`AuditLog.before/after` (JSON)** can capture sensitive field values; ensure
   redaction before writing (app concern, not visible in schema).
3. Redaction of `ProviderCall.requestBody` and `Payment.rawResponse` is
   **app-enforced** (comments), not DB-guaranteed.
4. No row-level security / column encryption at the DB layer (all app-layer) —
   acceptable, but means a DB compromise exposes plaintext PII.

## 21. Suggested improvements

**None implemented — this is a review.** Ordered by value:

1. **Protect the wallet ledger from user deletion.** Change `Wallet→User` /
   `WalletTransaction→User` from `Cascade` to `Restrict` (or rely solely on soft
   delete + a hard-delete guard), so financial history gets the same protection
   as orders/payments (§4, §15).
2. **Enforce "one active FX rate per pair"** with a partial unique:
   `UNIQUE(baseCurrency,quoteCurrency) WHERE isActive` (§5, §13) — turns a
   correctness-critical invariant from app discipline into a DB guarantee.
3. **Reconcile soft delete with uniques.** Replace hard uniques on
   `User.email`, `Product.sku`, `Category.slug`, `Game.slug` with partial uniques
   `... WHERE deletedAt IS NULL`, so a value can be reused after soft delete
   (§11).
4. **Adopt time-ordered UUIDs (v7/ULID)** for append-heavy PKs
   (`orders`, `order_items`, `provider_calls`, `audit_logs`) to cut index write
   amplification (§10, §19).
5. **Make the ledger and audit log append-only in the DB** (a `BEFORE
   UPDATE/DELETE` trigger raising, or `REVOKE`), rather than by convention
   (§12, §15).
6. **Add the two useful FK indexes** `Refund(paymentId)` and `Order(couponId)`
   if the reverse queries materialise (§7).
7. **Resolve the `ProductCode.orderItemId` SetNull ↔ CHECK contradiction** —
   decide whether a used code may be unlinked, and make the rule consistent
   (§4).
8. **Housekeeping:** remove the **orphaned trailing `///` doc comment** at the
   end of the schema (the "REPORTING ROLLUPS" block after `NotificationTemplate`
   documents a `DailyRollup` that is already defined earlier), and de-duplicate
   the `daily_rollups` creation between the model migration and the raw
   `CREATE TABLE IF NOT EXISTS` (§19).
9. **Revisit the order total-consistency CHECK** before enabling
   `taxInclusive` VAT, so the invariant still holds for tax-inclusive pricing
   (§16).

---

### Appendix — how this was audited

- Read `schema.prisma` in full plus all four migration SQL files.
- Enumerated models/enums, every `@id`/`@@id`/`@unique`/`@@unique`/`@@index`,
  and all 48 `onDelete` actions.
- Cross-referenced migration SQL for `CHECK` constraints, partial/GIN/BRIN
  indexes, extended statistics, sequences and autovacuum settings that the DSL
  does not surface.
- Distinguished DB-enforced invariants from application-enforced ones throughout.

*No schema or migration files were modified.*
