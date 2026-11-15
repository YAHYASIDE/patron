# Markets & Intelligence — API contract

Base `/api/v1`. Errors use the standard envelope with a stable `error` code. Staff routes need the
permission shown (super_admin bypasses). Models: `MarketCountry`, `MarketPaymentMethod`,
`ProductMarketRule`, `Discovery`, `DiscoveryDecision`, `AgentRun` (schema.prisma, section
"MARKETS & INTELLIGENCE").

## Markets

| Method & path | Permission | Body / query | Returns |
|---|---|---|---|
| `GET /markets` | public | — | `[{ code, nameAr, nameFr, nameEn, currency, currencies, languages, dialCode }]` — enabled countries only |
| `GET /admin/markets` | `markets.manage` or `intelligence.read` | — | `[{ ...country, enabled, lastResearchedAt, methods: { pending, approved, active, rejected, deferred }, rules: { pending, approved }, stale: number }]` |
| `POST /admin/markets` | `markets.manage` | `{ code, nameAr, nameFr, nameEn, currency, currencies?, languages?, dialCode, notes? }` | country (created **disabled**); also raises a discovery `market.research-needed:<code>` |
| `PATCH /admin/markets/:code` | `markets.manage` | any of the above + `enabled` | country |
| `GET /admin/markets/:code` | `markets.manage` or `intelligence.read` | — | `{ country, methods: [...], rules: [...], accounts: [{ id, method, enabled, usable }] }` (accounts = the owner's manual accounts serving this country) |
| `POST /admin/markets/:code/methods` | `markets.manage` | `{ items: [{ key, name, provider?, kind, currency?, fees?, sources: [{url,title,publisher?,accessedAt}], confidence, verifiedBy }] }` | upserts by (country, key): new → PENDING_REVIEW; an existing row keeps its status and decision, only facts, sources and `lastVerifiedAt` are refreshed |
| `POST /admin/markets/methods/:id/decision` | `markets.manage` | `{ action: 'approve' \| 'reject' \| 'defer', note? }` | method |
| `POST /admin/markets/methods/:id/link-account` | `markets.manage` | `{ accountId }` | method → ACTIVE. Only if APPROVED, and the account exists, is usable (enabled + number) and lists this country. **Never edits the account.** Errors: `METHOD_NOT_APPROVED`, `ACCOUNT_NOT_USABLE`, `ACCOUNT_OTHER_COUNTRY` |
| `POST /admin/markets/:code/rules` | `markets.manage` | `{ items: [{ scope, ref, availability, note?, sources, confidence, verifiedBy }] }` | upsert like methods |
| `POST /admin/markets/rules/:id/decision` | `markets.manage` | `{ action, note? }` | rule |
| `GET /markets/:code/rules` | public | — | APPROVED rules only: `[{ scope, ref, availability, note }]` (the store shows a notice) |

Staleness: a method or rule whose `lastVerifiedAt` is older than **90 days** (setting
`markets.stale_days`) counts as stale and is reported by the scanner.

## Intelligence

| Method & path | Permission | Body / query | Returns |
|---|---|---|---|
| `GET /admin/intelligence/summary` | `intelligence.read` | — | `{ counts: { new, critical, opportunities, pending, done, deferred }, tests: { last: AgentRun? }, agents: [{ agent, lastRun: AgentRun }], scanners: [{ name, lastRunAt, stale: boolean }] }` |
| `GET /admin/intelligence/discoveries` | `intelligence.read` | `?tab=new\|critical\|opportunities\|pending\|done\|deferred\|all&kind=&severity=&q=&limit=&cursor=` | `{ data: Discovery[], nextCursor }` |
| `GET /admin/intelligence/discoveries/:id` | `intelligence.read` | — | Discovery + `decisions` |
| `POST /admin/intelligence/discoveries/:id/decision` | `intelligence.decide` | `{ action: 'approve'\|'reject'\|'defer'\|'reopen'\|'start'\|'done', note?, deferDays? }` | Discovery |
| `GET /admin/intelligence/decisions` | `intelligence.read` | `?limit=` | decision log (discoveries + market methods/rules), newest first |
| `GET /admin/intelligence/agent-runs` | `intelligence.read` | `?agent=&limit=` | AgentRun[] |
| `POST /admin/intelligence/scan` | `intelligence.decide` | — | runs the in-app scanners now → `{ run: AgentRun, created, updated }` |
| `POST /admin/intelligence/ingest` | header `x-intel-token` = env `INTEL_INGEST_TOKEN` (disabled when unset), or a staff token with `intelligence.decide` | `{ agent, trigger, status, summary?, commit?, branch?, tests?: { passed, failed }, discoveries?: DiscoveryInput[], market?: { code, methods?: [...], rules?: [...] } }` | `{ run, created, updated }` |

Tabs: **new** = NEW; **critical** = CRITICAL/HIGH and not DONE/REJECTED; **opportunities** = kind
`opportunity`; **pending** = PENDING_REVIEW (+ market methods/rules pending, as summary counts);
**done** = DONE; **deferred** = DEFERRED.

`DiscoveryInput = { fingerprint, kind, title, description, evidence: [{type, ref, detail?}],
confidence, verified, severity, impact, proposal, testResults?, branch?, prUrl? }`. Upsert by
fingerprint: an existing row keeps its status and decisions, gets `seenCount + 1`, `lastSeenAt`, the
newer evidence; a DONE/REJECTED row that is seen again is **not** reopened automatically (a
`reappeared` flag in `testResults` is set instead) — a person decides.

Rules for every writer: never store API keys, tokens, passwords, OTPs or customers' personal data in
discoveries or runs (scrub phone numbers/emails to masked forms); a guess is `verified: false` with an
honest confidence; CRITICAL discoveries raise a staff notice `intel.critical`.

## In-app scanners (daily repeatable job + `POST /scan`)

1. **catalog-readiness** — active products that cannot be sold as listed (AUTO_PROVIDER without a ready
   provider, no price in a served country's currency, missing account inputs, region-locked SKUs such as
   `-US-` gift cards without a market rule).
2. **payments-by-country** — enabled countries with no usable payment account; accounts serving every
   country (empty `countries`); accounts enabled without a number; ACTIVE market methods whose account
   is no longer usable.
3. **market-staleness** — methods/rules older than the stale threshold; enabled countries never
   researched.
4. **server-errors** — repeated server errors (feedback module) not yet tracked.
5. **search-gaps** — store searches without results (insights) → opportunities.

Each scanner records an AgentRun (`agent: scanner:<name>`, trigger `app`) and upserts discoveries.
