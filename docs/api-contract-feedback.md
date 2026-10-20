# API contract: learning from the shop (errors and opportunities)

The owner wants to find problems and missing products without reading logs.
The store and the dashboard report what visitors run into; the dashboard shows
it in Arabic. Routes are under `/api/v1`. Table `store_events`
(migration `20261019070000_store_events`).

## Reporting (store and dashboard → API)

`POST /events` — public; a bearer token is optional and, when valid, links the
event to the customer. At most 60 requests a minute per IP. Answers
`202 { ok: true }`; a bad body answers 400 and the caller ignores it.

```json
{ "kind": "search_miss" | "brand_view" | "suggestion" | "client_error",
  "value": "string, 1–300 chars",
  "path": "optional, ≤200 chars, the page path",
  "detail": { "optional object, ≤2000 chars as JSON" } }
```

| kind | value | detail |
|---|---|---|
| `search_miss` | what was typed (a search that showed no brand) | — |
| `brand_view` | brand key, e.g. `g-pubg-mobile` | `{ "title": "ببجي موبايل" }` |
| `suggestion` | the customer's text ("أضيفوا…") | `{ "contact": "optional phone/name for guests" }` |
| `client_error` | the error message | `{ "app": "store" \| "admin", "stack": "≤1500 chars", "ua": "user agent" }` |

The server also records its own unexpected errors (HTTP 5xx) as
`kind: "server_error"`, `value` = the error message, `detail` = `{ method, status, correlationId }`.
Events older than 90 days are deleted by the nightly retention job.

## Owner (dashboard)

`GET /admin/opportunities?days=7|30|90` (permission `reports.read`, default 30):

```json
{ "days": 30,
  "searchMisses": [{ "query": "free fire brasil", "count": 12, "lastAt": "ISO" }],
  "suggestions":  [{ "id": "uuid", "text": "…", "contact": "…|null", "createdAt": "ISO",
                     "user": { "id": "uuid", "fullName": "…", "phone": "+222…" } | null }],
  "abandoned":    [{ "productId": "uuid", "sku": "TOP-PUBG-60", "nameAr": "…", "checkouts": 5,
                     "customers": 4, "lastAt": "ISO" }],
  "mostViewed":   [{ "brandKey": "g-pubg-mobile", "title": "ببجي موبايل", "views": 120 }] }
```

- `searchMisses`: top 30, grouped case-insensitively with spaces collapsed.
- `suggestions`: newest 50.
- `abandoned`: products in checkouts (quotes) that never became an order, top 20 by checkouts.
- `mostViewed`: top 20 brand pages by views; `title` is the latest one reported.

`GET /admin/errors?days=7` (permission `reports.read`, default 7) → newest first, at most 50 groups:

```json
[{ "source": "store" | "admin" | "server", "message": "…", "count": 3, "lastAt": "ISO",
   "lastPath": "/checkout" | null, "lastUa": "…" | null, "stack": "…" | null }]
```

Grouped by source and the first 200 characters of the message.
