# API contract for the 50 additions

Shared by the parallel work: the API implements exactly these routes and shapes;
the store and the dashboard call them. All routes are under `/api/v1`. "Customer"
routes need a signed-in user (bearer token); "admin" routes need the permission
shown. Money is a decimal string in the base currency (USD) unless a `currency`
is given. Errors use the existing `{ message, error }` shape.

Schema (migration `20261019050000_customer_features`): `users.country/city/adminNote/tags`,
`orders.adminNote`, `products.etaMinutes`, tables `saved_inputs`, `favorites`,
`price_watches`, `reviews`, `support_tickets` (see schema.prisma).

## Customer

### Profile
- `PATCH /users/me` — also accepts `country` (ISO-3166 alpha-2, uppercase) and
  `city` (1–60 chars, letters/spaces), `locale` (ar|fr|en), `defaultCurrency`.
  `GET /auth/me` returns `country`, `city`.

### Saved account IDs (#8)
- `GET /me/saved-inputs?gameId=<uuid>` → `[{ id, gameId, label, values: {key: value}, updatedAt }]` newest first.
- `POST /me/saved-inputs` `{ gameId, label?: string(≤40), values: {key: value} }` → the row.
  Same `gameId` + same `values` updates `updatedAt` instead of duplicating; at most 10 per game (oldest dropped).
- `DELETE /me/saved-inputs/:id` → `{ deleted: true }`.

### Favourites (#6)
- `GET /me/favorites` → `string[]` brand keys (e.g. `g-pubg-mobile`, `gc-apple-us`).
- `PUT /me/favorites/:brandKey` → `{ brandKey }` (brand key `^[a-z0-9-]{2,60}$`).
- `DELETE /me/favorites/:brandKey` → `{ deleted: true }`.

### Price and stock alerts (#11, #12)
- `GET /me/watches` → `[{ id, productId, kind: 'price'|'stock', priceAtWatch, notifiedAt, createdAt,
  product: { id, sku, nameAr, nameEn, gameId } }]`.
- `POST /me/watches` `{ productId, kind }` → the row (idempotent per user+product+kind; re-arms a notified one).
- `DELETE /me/watches/:id`.
- A repeatable job (hourly) notifies: `price` when the product's base sell price is below `priceAtWatch`;
  `stock` when the product is in stock again. Sets `notifiedAt`.

### Notifications (#13, #14) — existing routes
- `GET /notifications?page&limit` → paginated `{ data: [{ id, titleAr, titleEn, bodyAr, bodyEn, data, isRead, createdAt }], meta }`.
  `data` may carry `{ type, orderId?, productId?, link?, fr?: { title, body } }`.
- `GET /notifications/unread-count` → `{ count }`.
- `POST /notifications/read` `{ ids?: string[] }` (no ids = all) → `{ updated }`.
- The server creates IN_APP notifications on: order paid (`type: 'order.paid'`), order delivered
  (`'order.delivered'`), manual transfer rejected (`'payment.rejected'`, with the reason), support reply
  (`'support.reply'`), price drop / back in stock (`'watch.price' | 'watch.stock'`), broadcast (`'broadcast'`).
  Texts in Arabic and English, French in `data.fr`.

### My codes (#5)
- `GET /me/codes` → `[{ orderId, orderNumber, itemId, productId, productNameAr, productNameEn, quantity,
  deliveredAt, results: [{ id, resultType, revealed }] }]`, newest first, delivered items only.
  Values are read with the existing `POST /orders/items/:itemId/reveal`.

### Reviews (#15)
- `POST /reviews` `{ orderItemId, rating: 1–5, comment?: string(≤500) }` → the review. Only the buyer, only a
  DELIVERED item, once per item (409 `ALREADY_REVIEWED`).
- `GET /me/reviews` → `string[]` orderItemIds already reviewed.
- `GET /catalog/reviews?productIds=<id>,<id>` (public) → `{ average: number|null, count, items: [{ id, rating,
  comment, author: "Mohamed A.", createdAt, reply }] }` (published only, newest 20).

### Support (#16)
- `POST /support/tickets` `{ orderId?: uuid, subject: string(3–80), message: string(5–1000) }` → ticket.
  `orderId` must be the customer's own order.
- `GET /support/tickets` → the customer's tickets `[{ id, orderId, orderNumber, subject, message, status, reply, repliedAt, createdAt }]`.

### Store facts (public) (#20, #21, #26, #27, #28)
- `GET /catalog/best-sellers?limit=8` → `[{ productId, sku, gameId, units }]` (delivered units, last 30 days; ≤ 20).
- `GET /catalog/stats` → `{ ordersDelivered, customers }` (cached 10 min).
- `GET /catalog/rates` → `{ base: 'USD', rates: { MRU: number, XOF: number, DZD: number, EUR: number } }` (latest active).
- Public product payloads include `createdAt` and `etaMinutes`.

## Owner (dashboard)

### Insights (#31, #32, #33, #47, #50)
- `GET /admin/insights/overview?lowStock=3&margin=5` (reports.read) →
  `{ today: { revenue, cost, profit, orders }, yesterday: { revenue, cost, profit, orders },
     pendingTransfers, pendingVerifications, openTickets,
     lowStock: [{ productId, sku, nameAr, available }],   // products that have code stock, available ≤ lowStock
     marginAlerts: [{ productId, sku, nameAr, sellPrice, costPrice, marginPercent }],  // active, margin < target or below cost
     staleFx: ['XOF', …] }`
- `GET /admin/insights/pulse` (orders.read) → `{ latestOrderId, latestOrderNumber, latestOrderAt,
  pendingTransfers, pendingVerifications, openTickets }` (cheap; the dashboard polls it every 20 s) (#35).
- `GET /admin/insights/locations` (users.read) → `[{ country: 'MR'|null, city: string|null, customers, orders, revenue }]` (#36).

### Customers (#37)
- `GET /admin/customers/:id` (users.read) → `{ id, fullName, phone, email, country, city, adminNote, tags,
  phoneVerifiedAt, isBlocked, createdAt, lastLoginAt, stats: { orders, paidOrders, totalSpentBase, lastOrderAt },
  orders: [{ id, orderNumber, status, total, currency, createdAt }] (latest 20) }`.
- `PATCH /admin/customers/:id` (users.write) `{ adminNote?: string(≤1000)|null, tags?: string[](≤10, each ≤20) }`.

### Orders (#38, #49)
- `PATCH /admin/orders/:id/note` (orders.fulfil_manual) `{ note: string(≤1000)|null }` → `{ adminNote }`.
- `GET /admin/orders` additionally filters `gateway` (MANUAL|WALLET|STRIPE), `country` (customer's), `from`, `to` (ISO dates).
  Each row includes `adminNote` and the customer's `country`.

### Catalogue tools (#34, #45)
- `POST /admin/catalog/products/bulk-price` (catalog.pricing) `{ categoryId?, gameId?, productIds?: uuid[],
  percent: number (-50..100), dryRun: boolean }` → `{ items: [{ id, sku, nameAr, from, to, costPrice, belowCost }],
  applied: number }`. Prices round to 2 decimals; a new price below cost is never applied (reported `belowCost`).
- `POST /admin/catalog/products/:id/clone` (catalog.write) → the new product (SKU `<sku>-COPY[n]`, inactive, no codes).

### Data (#39, #40)
- `GET /admin/export/orders.csv?from&to` (reports.read) — CSV (UTF-8 with BOM): order number, date, status, customer,
  phone, country, items, total, currency, payment method.
- `GET /admin/export/customers.csv` (users.read) — name, phone, email, country, city, verified, orders, spent, joined.
- `GET /admin/backup` (settings.manage) — JSON download `{ version: 1, exportedAt, counts, users, orders (items,
  inputs, payments without raw gateway payloads), products, prices, categories, games, banners, coupons, settings }`.
  Never includes password hashes, refresh tokens, 2FA secrets, product code values or upload bytes.

### Marketing and service (#41, #42, #43, #44, #46, #48)
- Coupons (coupons.manage): `GET /admin/coupons`, `POST /admin/coupons` `{ code, discountType: PERCENT|FIXED,
  discountValue, maxDiscount?, minOrderTotal?, maxUses?, maxUsesPerUser?, startsAt?, expiresAt?, isActive? }`,
  `PATCH /admin/coupons/:id` (same fields, partial).
- Reviews (catalog.write): `GET /admin/reviews?published=true|false` → rows with product and customer name;
  `PATCH /admin/reviews/:id` `{ isPublished?, reply?: string|null }`.
- Support (users.write): `GET /admin/support/tickets?status=OPEN|ANSWERED|CLOSED` → rows with customer and order;
  `PATCH /admin/support/tickets/:id` `{ reply?: string(≤1000), status? }` — a reply sets ANSWERED and notifies.
- WhatsApp quick replies (settings.manage): `GET /admin/shop/templates` → `[{ id, title, body }]`;
  `PUT /admin/shop/templates` `{ templates: [...] }` (≤20). Bodies may use `{name}`, `{order}`, `{link}`.
- Activity log (audit.read): `GET /admin/audit?cursor&limit&entityType&action` →
  `{ data: [{ id, action, entityType, entityId, actor: { fullName, email } | null, createdAt }], nextCursor }`.
- Broadcast (notifications.send): `POST /admin/notifications/broadcast` `{ titleAr, bodyAr, titleFr?, bodyFr?,
  titleEn?, bodyEn?, link?, country? }` → `{ sent }` (active customers; optionally one country).
