# Developer guide

## Getting started

```bash
docker compose up -d postgres redis
npm install
cp .env.example .env
openssl rand -hex 32   # ENCRYPTION_KEY, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET

npx prisma migrate dev && npx prisma generate && npm run db:seed
npm run start:dev          # API + Swagger at /docs
npm run start:worker:dev   # queues + outbox relay
```

The worker is a **separate process** on purpose. A 20-second provider call must
never compete with API request latency, and workers scale and restart
independently.

---

## Architecture

Three layers, and the rule is that dependencies only point downward.

```
  HTTP / Queue          controllers, processors — no business logic
        ↓
  Domain services       the rules. This is where the system lives.
        ↓
  Infrastructure        prisma, crypto, outbox, locking, metrics, tracing
```

A controller that contains an `if` about business rules is a bug. A domain
service that knows about HTTP status codes is a bug.

### Reading order for a new engineer

1. [`adr/README.md`](adr/README.md) — **start here.** Seventeen decisions with
   their reasoning. The *why* lives there, not in the code.
2. `prisma/schema.prisma` — the domain, and the constraints that enforce it.
3. `modules/orders/quotes.service.ts` — the price lock, which everything else
   depends on.
4. `modules/providers/provider-engine.service.ts` — failover and idempotency.
5. `common/outbox/outbox.service.ts` — why nothing enqueues directly.

### Module responsibilities

| Module | Owns | Must not |
|---|---|---|
| `auth` | Identity, sessions, OTP, lockout | Know about orders |
| `users` / `roles` / `permissions` | Accounts and the permission matrix | Contain business rules |
| `catalog` | Categories, games, products, **pricing** | Know about orders |
| `orders` | Quotes, orders, state machine | Call providers or gateways directly |
| `payments` | Gateways, capture, webhooks | Fulfil anything |
| `refunds` | Request → approve → process | Move wallet money outside `WalletService` |
| `wallet` | The ledger | Be bypassed. Ever. |
| `providers` | Adapters, registry, engine | Leak a provider name upward |
| `notifications` | Templates, channels | Be called synchronously from a request |
| `fx` | Rate history and sync | Be read directly — go through `PricingService` |
| `reports` | Aggregation, analytics, export | Write anything |
| `queues` | BullMQ, outbox relay, scheduled jobs | Contain business logic |

**The one rule that matters most:** `PricingService` is the only place that
converts currency, and `WalletService.post()` is the only place a balance
changes. If you find yourself writing either of those elsewhere, stop.

---

## Coding standards

### Money

```ts
// Never.
const total = price * quantity;

// Always.
const total = price.mul(quantity);
```

All money is `Prisma.Decimal`. `0.1 + 0.2 !== 0.3` is an accounting discrepancy
at scale, not a curiosity. Serialise with `serialiseMoney()` — JSON numbers lose
precision silently.

### Transactions

```ts
// Never — a provider outage now holds a row lock.
await prisma.$transaction(async (tx) => {
  await tx.order.update(...);
  await provider.fulfil(...);   // network call inside a transaction
});

// Always — call outside, then commit the result.
const outcome = await provider.fulfil(...);
await prisma.$transaction(async (tx) => { await tx.order.update(...); });
```

Never put a network call inside a transaction. Keep transactions short and
lock-ordered (`wallet → order → payment → refund`, via `acquireLocks()`).

### Side effects

```ts
// Never — the job survives a rolled-back transaction, or is lost on a crash.
await prisma.$transaction(...);
await queue.add('fulfil', { orderId });

// Always — the intent commits with the state change.
await prisma.$transaction(async (tx) => {
  await tx.order.update(...);
  await outbox.emit(tx, { aggregate: 'Order', eventType: 'order.paid', ... });
});
```

### Concurrency

Anything that can happen twice, will. Guard with a conditional update:

```ts
const { count } = await tx.order.updateMany({
  where: { id, status: 'PENDING_PAYMENT' },   // the guard
  data: { status: 'PAID' },
});
if (count === 0) return { alreadyHandled: true };
```

### Naming

| Thing | Convention | Example |
|---|---|---|
| Files | kebab-case, suffixed by role | `provider-engine.service.ts` |
| Classes | PascalCase | `ProviderEngine` |
| Money fields | suffix the currency basis | `totalBase`, `unitCostBase` |
| Encrypted fields | `Enc` suffix | `apiKeyEnc`, `valueEnc` |
| Booleans | `is` / `has` | `isHealthy`, `hasMore` |
| Timestamps | past-tense verb + `At` | `paidAt`, `deliveredAt` |
| Permissions | `module.action` | `orders.refund` |
| Events | `aggregate.past-tense` | `order.paid` |

### Comments

Comment the *why*, never the *what*. `// increment the counter` above `count++`
is noise. `// Unconditional, because a conditional lock is a lock ordering that
depends on data` is the reason the next person does not "simplify" it into a
deadlock.

---

## Adding a provider

Roughly an hour. No change to the order pipeline — see
[ADR 002](adr/002-provider-engine-strategy.md).

**1. Write the adapter** (`modules/providers/adapters/newprovider.adapter.ts`):

```ts
@Injectable()
export class NewProviderAdapter extends BaseHttpAdapter implements ProviderAdapter {
  readonly code = 'newprovider';

  async fulfil(req: FulfilRequest, creds: ProviderCredentials): Promise<FulfilOutcome> {
    // Pass req.idempotencyKey through. This is what stops a timeout-then-retry
    // becoming a second purchase — the single most expensive bug available.
  }
  async checkStatus(...) {}
  async getBalance(...) {}
  async healthCheck(...) {}
}
```

Map errors honestly. `retryable: true` means "the same request might work in a
moment". A bad player ID is **not** retryable — marking it so burns money
against every configured provider in turn.

**2. Register it** in `ProviderRegistry.onModuleInit` and `ProvidersModule`.

**3. Insert the rows:**

```sql
INSERT INTO providers (id, code, name, "baseUrl", "apiKeyEnc", priority)
VALUES (gen_random_uuid(), 'newprovider', 'New Provider', 'https://api...', '<encrypted>', 2);

INSERT INTO product_providers ("productId", "providerId", "providerSku", "providerCost", priority)
VALUES (...);
```

**4. Test it** against the sandbox: success, out of stock, invalid input,
timeout, 500, duplicate request with the same idempotency key. Copy
`test/integration/provider-failure.spec.ts`.

**Do not** add a `if (provider.code === 'newprovider')` anywhere outside the
adapter. If you need to, the interface is wrong — change the interface.

## Adding a payment gateway

Same shape. Implement `PaymentGateway`, register in `GatewayRegistry`, add to
the `PaymentGateway` enum and a migration.

Watch **minor units**: XOF has none, so 2500 XOF is `2500`, not `250000`. Get
this wrong and you overcharge by 100×. See `StripeGateway.toMinorUnits`.

Verify webhooks against the **raw body** with a constant-time comparison, and
reject stale timestamps.

## Adding a product

Through the admin API, not SQL:

```http
POST /admin/catalog/products
{
  "sku": "PUBG-UC-600", "type": "GAME_TOPUP", "delivery": "AUTO_PROVIDER",
  "nameAr": "...", "nameEn": "PUBG 600 UC",
  "categoryId": "...", "gameId": "...",
  "costPrice": 28.00, "sellPrice": 34.00,
  "prices": [{ "currencyCode": "XOF", "sellPrice": 21000 }]
}
```

`costPrice` and `sellPrice` are **always base currency (USD)**.

Add a manual `prices` override for XOF and MRU. Converting $34 gives 20,546 XOF
— a conversion artifact, not a price. See
[ADR 007](adr/007-multi-currency.md).

`GAME_TOPUP` requires a `gameId`, because the game owns the `inputSchema` that
drives the checkout form.

---

## Testing

```bash
npm run test:unit         # pure logic, no I/O — run on every save
npm run test:integration  # real Postgres via testcontainers
npm run test:e2e          # full HTTP, providers stubbed with nock
npm run test:resilience   # chaos, stress, outage — slow, nightly in CI
```

Integration tests use a **real database**, not a mocked Prisma. The failures
that matter — CHECK constraints, unique indexes, `FOR UPDATE`, rollback — only
exist there. See [ADR 011](adr/011-test-strategy.md).

### The tests that must never be deleted

| Test | Property |
|---|---|
| `checkout.concurrency` › concurrent submit | Exactly one order per quote |
| `payments.webhook` › replayed capture | Exactly one `order.paid` event |
| `wallet.concurrency` › concurrent debits | No over-spend |
| `provider-engine` › non-retryable error | Second provider **not** called |
| `outbox` › rolled-back transaction | No claimable event |
| `lock-ordering` › opposing transactions | Zero deadlocks |

Each corresponds to a way the platform could charge a customer twice or pay a
provider twice. If one breaks, stop and fix it — do not skip it.

### Writing concurrency tests

Assert on the **database**, not on return values. `Promise.allSettled` on
genuinely parallel calls, then query and check the invariant:

```ts
await Promise.allSettled([submit(), submit(), submit()]);
expect(await prisma.order.count({ where: { quoteId } })).toBe(1);
```

---

## Release workflow

1. Branch from `main`, one logical change.
2. Write the ADR **first** if it is an architectural decision. Writing it often
   changes the decision.
3. Migrations backward-compatible — expand/contract across two releases.
4. Tests, including a concurrency test if the change touches money.
5. PR: CI runs lint, types, drift, unit, integration, e2e, audit, CodeQL, Trivy.
6. Merge, tag `vX.Y.Z`, pipeline deploys to staging and load-tests it.
7. Manual approval for production.
8. Watch the dashboard for 15 minutes. Deploys fail late more often than early.

Checklist: [`OPERATIONS.md` § 10](OPERATIONS.md).

---

## Common tasks

**Add a permission:** append to `PERMISSIONS` in `prisma/seed.ts`, grant it in
`ROLE_PERMISSIONS`, re-seed, use `@RequirePermissions('module.action')`. There
is deliberately no API to create permissions — they are a fixed catalogue owned
by the codebase, so the guards and the database cannot drift apart.

**Add a scheduled job:** add to `JOBS`, handle it in `MaintenanceProcessor`,
register the cron in `QueuesModule.onModuleInit`. It must be idempotent —
delivery is at-least-once.

**Add a notification:** insert a `NotificationTemplate` row, emit an outbox
event, route it in `OutboxRelay.publish`. Templates are database rows so copy
changes do not need a deploy.

**Debug a stuck order:**

```sql
SELECT o."orderNumber", o.status, i.status AS item_status, i."lastError",
       i."attemptCount", p.code AS provider
FROM orders o
JOIN order_items i ON i."orderId" = o.id
LEFT JOIN providers p ON p.id = i."fulfilledByProviderId"
WHERE o."orderNumber" = 'PTN-1000042';

SELECT * FROM provider_calls WHERE "orderItemId" = '<item-id>' ORDER BY "createdAt";
```

With tracing on, search the trace id — it is the correlation id in every log
line and error response.
