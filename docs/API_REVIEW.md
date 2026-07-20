# API endpoint review

Every endpoint audited against six criteria. `—` means not applicable.

| Endpoint | Validation | Authorization | Rate limit | Idempotent | Pagination | Docs |
|---|---|---|---|---|---|---|
| `POST /auth/register` | ✅ | Public | 5/min | — | — | ✅ |
| `POST /auth/login` | ✅ | Public | 10/min + lockout | — | — | ✅ |
| `POST /auth/refresh` | ✅ | Public | global | rotation | — | ✅ |
| `POST /auth/logout` | ✅ | Public | global | idempotent by nature | — | ✅ |
| `POST /auth/logout-all` | — | authenticated | global | idempotent | — | ✅ |
| `GET /auth/me` | — | authenticated | global | — | — | ✅ |
| `POST /auth/change-password` | ✅ | authenticated | global | — | — | ✅ |
| `POST /auth/verify-email` | ✅ | authenticated | global | single-use code | — | ✅ |
| `POST /auth/forgot-password` | ✅ | Public | 3/5min | — | — | ✅ |
| `POST /auth/reset-password` | ✅ | Public | 5/5min | single-use code | — | ✅ |
| `GET /catalog/*` | ✅ | Public | global | — | offset (bounded) | ✅ |
| `POST /checkout/quotes` | ✅ | authenticated | global | — | — | ✅ |
| `GET /checkout/quotes/:id` | — | ownership | global | — | — | ✅ |
| `POST /checkout/orders` | ✅ | authenticated | global | **required** | — | ✅ |
| `GET /orders` | ✅ | ownership | global | — | **cursor** | ✅ |
| `GET /orders/:id` | — | ownership | global | — | — | ✅ |
| `POST /orders/items/:id/reveal` | — | ownership | global | idempotent | — | ✅ |
| `GET /payments/methods` | — | Public | global | — | — | ✅ |
| `POST /payments` | ✅ | ownership | global | **required** | — | ✅ |
| `POST /payments/:id/confirm` | — | authenticated | global | idempotent | — | ✅ |
| `POST /webhooks/payments/:source` | signature | Public + sig | global | replay-protected | — | ✅ |
| `GET /wallet` | — | authenticated | global | — | — | ✅ |
| `GET /wallet/transactions` | ✅ | authenticated | global | — | take 50 | ✅ |
| `POST /wallet/adjust` | ✅ | `wallet.adjust` | global | — | — | ✅ |
| `GET /notifications` | ✅ | authenticated | global | offset | — | ✅ |
| `POST /notifications/read` | ✅ | authenticated | global | idempotent | — | ✅ |
| `GET /users`, `/users/:id` | ✅ | `users.read` | global | — | offset | ✅ |
| `POST/PATCH /users` | ✅ | `users.write` | global | — | — | ✅ |
| `PATCH /users/:id/block` | ✅ | `users.block` | global | idempotent | — | ✅ |
| `GET/POST/PATCH/DELETE /roles` | ✅ | `roles.manage` | global | — | — | ✅ |
| `GET /permissions` | — | `roles.manage` | global | — | — | ✅ |
| `admin/catalog/*` | ✅ | `catalog.*` | global | — | offset | ✅ |
| `admin/orders` | ✅ | `orders.read` | global | — | **cursor** | ✅ |
| `admin/orders/:id/cancel` | ✅ | `orders.cancel` | global | state machine | — | ✅ |
| `admin/refunds` | ✅ | `payments.refund` | global | conditional claim | — | ✅ |
| `admin/providers/*` | ✅ | `providers.*` | global | — | — | ✅ |
| `admin/fx/*` | ✅ | `settings.manage` | global | append-only | — | ✅ |
| `admin/reports/*` | ✅ | `reports.read` | **20/min** | — | capped | ✅ |
| `admin/reports/export/*` | ✅ | `reports.read` | **5/min** | — | capped | ✅ |
| `GET /health*` | — | Public | excluded | — | — | internal |
| `GET /metrics` | — | bearer token | excluded | — | — | internal |

---

## Changes made during this review

**Reports were throttled.** The global 120/min applied to endpoints that can
aggregate a year of orders. An admin dashboard on a refresh loop was a
self-inflicted DoS. Now 20/min for reports, 5/min for exports.

**Order lists moved to cursor pagination.** Offset degrades for the customers
with the most orders — the ones who matter most.

**Error responses were made consistent.** Validation failures, Prisma conflicts
and unhandled throws each produced a different JSON shape, so every client
needed three parsing paths. All endpoints now return:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "That email address is already in use",
  "correlationId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp": "2026-07-23T10:15:00.000Z",
  "path": "/api/v1/auth/register"
}
```

The correlation id is always present and is the trace id, so a customer can
quote it and support can open the exact trace.

**Unhandled exceptions no longer leak internals.** They previously returned the
exception message, which routinely contains table names and connection strings.
Now logged with a stack, returned as a generic message plus the correlation id.

---

## Conventions verified

- **Authenticated by default.** `JwtAuthGuard` is global; `@Public()` is the
  explicit exception, and each use has a reason.
- **Permission-based, not role-based.** Routes declare `module.action`; roles
  are bundles. A new role never needs a code change.
- **Ownership checks are explicit** on every customer-facing resource read.
- **`forbidNonWhitelisted`** rejects unknown properties rather than dropping
  them silently — a client sending `roleIds` to `/users/me` learns it failed.
- **Money-moving endpoints require `Idempotency-Key`** and replay the stored
  response.

---

## Accepted gaps

| Gap | Reason |
|---|---|
| No per-user rate limiting, only per-IP | Users behind one NAT share a limit. Acceptable; revisit if it bites |
| No API versioning beyond the `/api/v1` prefix | Single client, versioned prefix is enough until there is a public API |
| No request signing for admin endpoints | Bearer tokens over TLS are adequate at this scale |
