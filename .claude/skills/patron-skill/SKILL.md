---
name: patron-skill
description: >-
  The single source of truth for working on the Patron monorepo (digital-products
  marketplace: game top-ups, gift cards, subscriptions, software licenses). Invoke
  this for ANY Patron task — understanding the system, building features, writing or
  reviewing API/admin/mobile code, running the app, debugging, database/migrations,
  CI, or deciding what to build next. It carries the architecture, the full API
  surface, the data model, the conventions, the run/debug recipes, and the response
  protocol. Keep it updated as the project grows: it is trained by editing it, not
  by magic.
---

# Patron Skill

This is the project brain for **Patron**. Read it before acting on any Patron
task. It layers **on top of** the repo's `CLAUDE.md` engineering rules (which
always win on their topics). When this file and reality disagree, **trust the
code, fix this file.**

> **How this skill is trained:** it does not learn by itself. Every time we learn
> something new — a decision, a convention, a gotcha, a new module — we write it
> here in the same edit. That is the "training." A fact that only lives in chat is
> a fact that will be lost; a fact written here survives every new session.

---

## 1. What Patron is

A production-grade **digital-products marketplace** backend + (in-progress)
admin and mobile frontends. Customers buy game top-ups, gift cards,
subscriptions, and software licenses, pay from a wallet, and receive the
product (a code, a manual fulfilment, or an automatic provider top-up).

**Maturity (honest):**
- **Backend (`apps/api`): built and working.** 15 modules, 95 HTTP endpoints,
  40 DB models, 15 migrations, 86 test files, CI green, coverage ~93%.
- **Admin (`apps/admin`): built.** Real Next.js dashboard (login, dashboard,
  products, orders, currencies, settings) on the live `/api/v1`. Deployed.
- **Storefront (`apps/storefront`): built (phase 1).** Customer-facing Next.js
  store: home, catalog browse + search + category filter, product detail (game
  inputs + denominations), cart (localStorage), customer register/login,
  checkout (quote → order → pay), orders + code reveal, account + wallet. Talks
  to the PUBLIC `/api/v1`. **No guest checkout** — a quote needs a customer JWT.
- **Mobile (`apps/mobile`): Flutter scaffold.** Structure only.

The gap the user feels ("there's nothing to see") is real and expected: the
work went into the **engine**, not a visible **face**. Building the face is the
next phase and is now explicitly scoped.

## 2. Repository shape

Turborepo + npm workspaces. Drive everything from the **repo root**.

```
apps/api        NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis/BullMQ (built)
apps/admin      Next.js 15 (App Router) + React 19 + Tailwind 3     (built)
apps/storefront Next.js 15 customer store + React 19 + Tailwind 3   (built, phase 1)
apps/mobile     Flutter                                             (scaffold)
packages/tsconfig   shared TS base configs (@patron/tsconfig)
packages/types      shared framework-agnostic type contracts (@patron/types)
deploy/ docs/ root compose   cross-cutting infra
```

Root scripts (Turborepo): `build dev lint lint:check typecheck test format
format:check clean docker:up docker:down`. Scope with
`--workspace=@patron/<name>`. Never bypass the task runner.

## 3. The API surface (apps/api)

Global prefix `/api/v1`. 15 controllers, 95 endpoints, grouped by module:

| Module | Base path(s) | What it does |
|---|---|---|
| auth | `auth` | register, login, refresh-token rotation, device tokens |
| catalog | `catalog`, `admin/catalog` | categories, games, products, banners, prices |
| orders | `checkout`, `orders`, `admin/orders` | quotes (15-min price lock), orders, order items |
| payments | `payments`, `webhooks` | pay an order, provider/payment webhooks |
| wallet | `wallet` | append-only ledger balance + transactions |
| refunds | `admin/refunds` | issue/track refunds |
| fx | `admin/fx` | currencies + frozen exchange rates |
| providers | `admin/providers` | top-up provider engine (strategy + registry) |
| reports | `admin/reports` | CSV exports, base-currency reporting |
| users / roles / permissions | `users`, `roles`, `permissions` | RBAC |
| notifications | `notifications` | templates + delivery |
| health / metrics | `health`, `metrics` | liveness, Prometheus metrics |

**Money-moving endpoints require an `Idempotency-Key` header** (checkout
quotes, payments, wallet ops). Missing it → 400.

Every error is one envelope (ADR 019):
`{ statusCode, error, message, correlationId, timestamp, path }`.

## 4. Data model (apps/api/prisma/schema.prisma)

40 models. The ones you touch most:

- **Identity/RBAC:** User, Role, Permission, UserRole, RolePermission,
  RefreshToken, VerificationToken, LoginAttempt, DeviceToken.
- **Catalog:** Category, Game, Product, ProductCode, Banner,
  Provider, ProductProvider, ProviderCall.
- **Commerce:** CheckoutQuote, QuoteItem, QuoteItemInput, Order, OrderItem,
  OrderInput, OrderResult, Payment, Refund, Coupon.
- **Money:** Wallet, WalletTransaction, Currency, FxRate, ProductPrice.
- **Infra:** OutboxEvent, IdempotencyRecord, InboundWebhook,
  NotificationTemplate, Notification, AuditLog, DailyRollup, SystemSetting.

Product **delivery** kinds: `CODE_POOL` (pull a pre-stocked code),
`MANUAL` (admin fulfils), `AUTO_PROVIDER` (call a top-up provider).

**Known gap:** only HTTP provider adapters exist (fazercards, foxreload),
mapped to game top-ups. There is **no CODE_POOL auto-dispenser** yet, so a
CODE_POOL purchase currently ends unfulfilled (`no_provider`). This is a
feature to build, not a bug to hide.

## 5. Conventions (do not violate)

From `CLAUDE.md` — summarized, but `CLAUDE.md` is authoritative:

- **Structure & config only until a feature is explicitly scoped.** No
  pre-emptive business logic in admin/mobile scaffolds.
- **Reuse before you add.** Check `packages/*` and existing modules first.
- One logical change per commit; keep changes scoped to one app/package.
- **TypeScript:** every workspace extends a `@patron/tsconfig` base.
  `strictNullChecks` + `noImplicitAny` ON everywhere. The API does **not**
  enable full `strict` (NestJS DTOs need `strictPropertyInitialization` off) —
  keep it that way. Don't redefine options the shared base sets.
- **Lockfiles:** when you change an app's deps, update **both** the root
  `package-lock.json` **and** that app's own `package-lock.json`.
- **Prisma:** schema is the source of truth; changes go through
  `prisma migrate`; run `npx prisma format` before committing; migrations must
  not structurally drift (CI `api-drift` is a structural-only gate, ADR 020).
- **Secrets:** never commit real secrets; `.env.example` committed, `.env`
  ignored. No credentials/tokens/internal hostnames in code, comments, commits,
  or CI. No model identifier in any committed artifact.
- **Docker:** multi-stage, non-root, healthcheck, app-dir build context,
  minimal runtime.
- **CI must be green** before done. Don't lower gates, skip, only, or ignore.

## 6. Running the app locally (cloud container)

The API needs PostgreSQL + Redis. After a container recycle, `node_modules`,
the `pgrunner` Postgres, and the DB may be gone — rebuild before blaming code.

```bash
# from repo root
npm ci                                   # if node_modules is missing
# Postgres (pgrunner @ 127.0.0.1:5433 db 'patron') + Redis (6379) must be up
npm run build --workspace=@patron/api
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npx prisma db seed --schema apps/api/prisma/schema.prisma   # NOT `npm run seed`
node apps/api/dist/src/main.js           # serves on :3000, prefix /api/v1
```

Seeded admin: `admin@patron.io` / `$SEED_ADMIN_PASSWORD`. Seed also loads 4
currencies (USD base, EUR, MRU, XOF), FX rates, permissions/roles, categories,
games, providers, coupon `WELCOME10` (10% off, min order 25), templates,
settings. The 7 **demo products** (and their overrides/provider routes) load
only with `SEED_DEMO_CATALOG=true` (local dev); migration
`20261018000000_retire_demo_catalog` soft-deleted them from the live DB at the
user's request. Live `SEED_ON_BOOT` is `false` (the seed's upserts would
overwrite dashboard edits on every restart).

**Starter catalog pack** (`src/bootstrap/catalog-pack.ts`, run by the
entrypoint when `CATALOG_PACK=true`): the owner asked Claude to pick a full
catalog for them to prune. ~75 products across games (PUBG, Free Fire, MLBB,
COD Mobile, Genshin, Yalla Ludo, Jawaker), app top-ups (TikTok, Bigo), gift
cards (Apple, Google Play, PSN, Xbox, Steam, Roblox, Razer, Amazon, Fortnite,
Nintendo), subscriptions (Netflix, Shahid, OSN+, Disney+, YouTube, Spotify,
Anghami, Apple Music, Snapchat+, Telegram Premium, ChatGPT Plus, Canva,
Discord, Game Pass, PS Plus) and Microsoft 365. All MANUAL, USD; prices are
estimates for the owner to review. **Insert-only + once** (marker
`catalog.pack.v1` in `system_settings`): never update or re-add — the owner
curates from the dashboard. To ship more products later, add a new pack key
(`catalog.pack.v2`), never edit v1's expectations. Grey-market Windows/Office
keys were deliberately left out.

**Catalog pack v2** (`catalog.pack.v2`, same file): brands the owner listed that
v1 lacked (Netflix/Spotify gift cards, Riot Games for LoL/Valorant, Blizzard
Battle.net, Minecraft, Twitch, Discord Nitro 12M, Binance vouchers), the
"digital wallets" section (Razer Gold is moved there only if it still sits in
gift cards) and a hidden "crypto" section (Binance vouchers created
`isActive:false`). It also sets product art, but only where `imageUrl` is null,
so an owner image is never replaced. Art lives in
`apps/storefront/public/art/<sku lowercase>.svg`, generated by
`apps/storefront/scripts/generate-product-art.mjs` (Simple Icons marks; brands
it lacks, e.g. Xbox, Amazon, Minecraft, Nintendo, Microsoft, Disney, are set in
type). URLs are `${STOREFRONT_URL}/art/...` (`STOREFRONT_URL` is in
`render.yaml`). Adding SKUs later: add them to a new pack, rerun the generator
(`npm i --no-save simple-icons@15`), commit the SVGs.

**The running API is NOT reachable from the user's browser** (it binds inside
the cloud container). To show the user something visual, either build+publish a
real frontend, or publish an Artifact preview — and say plainly which one it is.

## 7. Debugging recipes (learned the hard way)

- **`health` returns 500 but server responds:** the DB/Redis connection
  dropped (usually a container recycle). The error *envelope* proves the API
  stack is alive. Restart Postgres/Redis, re-`migrate deploy`.
- **`Idempotency-Key header is required` (400):** add the header to the
  money-moving request (POST /checkout/quotes, POST /payments, wallet ops).
- **Quote/coupon 429:** throttler tier hit during rapid testing — wait out the
  window, don't "fix" it.
- **CODE_POOL purchase fails `no_provider`:** expected — no dispenser yet (§4).
- **No endpoint to upload codes:** there is no admin route to add `ProductCode`
  rows, so a CODE_POOL product is always `inStock:false` in the store, and an
  AUTO_PROVIDER one is out of stock unless it has an active+healthy
  `ProductProvider`. Today only **MANUAL** delivery sells end to end; the admin
  product form defaults to MANUAL and explains each mode.
- **Pricing (owner's rules):** the customer pays exactly the sell price the
  owner sets. `PricingService` never applies `currency.fx_markup_percent` to the
  **base** currency (nothing is converted), and migration
  `20261018201210_product_discount_no_markup` set that markup to 0 at the
  owner's request. Discounts are per product: `Product.discountPercent` (int
  0-90, null = none), applied inside `priceLoadedProduct` to every currency,
  overrides included, so the store, the quote and the charged total always agree.
  The public API returns `sellPrice` (after discount), `listPrice` (before) and
  `discountPercent`; `baseAmount` is post-discount, so profit reports stay true.
  The loss guard (`assertNotAtLoss`, create **and** update) rejects a discount
  that takes the price below cost. The sample coupon `WELCOME10` was deactivated
  (discounts are the owner's per-product choice) and the seed only creates it
  with `SEED_DEMO_CATALOG=true`. Starter-pack margins are ~10%, so larger
  discounts on those products are refused until the price or cost changes.
- **Admin product CRUD:** `/products/new` and `/products/[id]` share
  `apps/admin/components/ProductForm.tsx`. The API's ValidationPipe uses
  `forbidNonWhitelisted`, so the form builds the body from DTO fields only.
  `UpdateProductDto` extends `CreateProductDto` (PATCH needs the full body).
  `maxPerOrder` is non-nullable (default 10): omit it, never send null. There is
  no admin get-by-id, so the edit page finds the row in the admin list.
- **e2e fails from "registers a customer" on a rerun:** the test DB still holds
  the previous run's users and Redis holds login lockouts/throttle counters. CI
  is always fresh; locally drop/recreate the test DB, `redis-cli flushall`,
  `prisma migrate deploy`, then rerun. Not a code bug.
- **`nest build` emits only `.d.ts` locally:** a stale
  `apps/api/tsconfig.build.tsbuildinfo` (incremental + `deleteOutDir`) makes tsc
  think nothing changed. Delete it and rebuild. Docker builds are unaffected.
- **Admin Docker image fails on `../../packages/tsconfig`:** CI only ever builds
  the **API** image (ci.yml `build` job, context `./apps/api`); the admin image
  is **not** built in CI, so its Docker build is unverified until a real deploy.
  `apps/admin/tsconfig.json` extends `../../packages/tsconfig/nextjs.json`, which
  is outside the app-scoped Docker context (rule 9) → `next build` can't resolve
  it in the image. Fix mirrors the API's `tsconfig.build.json`: a self-contained
  `apps/admin/tsconfig.docker.json`, and the admin Dockerfile does
  `cp tsconfig.docker.json tsconfig.json` before `npm run build`. Keep it in sync
  with `packages/tsconfig`. Verify an image-context build by copying **only**
  `apps/admin` to a temp dir (no monorepo root), `npm ci`, `npm run build`.
- **`UID` lost in bash:** `UID` is readonly; use another name (`CID`).
- **Migration "drift" with zero structural ops:** it's operational SQL
  (indexes, defaults, FKs) — the structural-only gate (ADR 020) is correct;
  don't rewrite migrations to chase it.
- **CI `Security checks` red (`npm audit` in apps/api):** new advisories drop
  against existing transitive deps over time, so a green audit goes red with no
  code change. Fix at the source, never suppress: upgrade the direct dep that
  pulls the vuln, or pin a patched transitive version via `overrides`. If a leaf
  has no patched release (e.g. `braces <=3.0.3`), upgrade the parent that drops
  it (jest 30 removes micromatch/braces).
  **Which lockfile does the audit read?** The Security job runs `cd apps/api &&
  npm audit`, but *inside the workspace* npm resolves against the **root**
  `package-lock.json`, not apps/api's self-contained one. So the pins must go in
  the **root `package.json` `overrides`** to fix the gate. (Docker builds from
  apps/api's own context, so keep the same `overrides` in `apps/api/package.json`
  too — its standalone lockfile is what the image uses.) Put the override block
  in **both** package.json files.
  **npm gotcha — overrides only re-apply on a clean resolve:** `npm install`
  reuses existing `node_modules` and reports "up to date" without applying a new
  override. You must `rm -rf package-lock.json node_modules apps/*/node_modules`
  then `npm install` (or `npm install --package-lock-only`) so npm re-resolves
  from the registry. After a clean reinstall, run `npx prisma generate` before
  building/testing or every spec fails on missing Prisma types.
  Verify the exact CI command — `cd apps/api && npm audit --audit-level=moderate`
  → 0 — plus build, typecheck, lint, 794 unit tests and coverage, before commit.

## 8. Next phase: the visible product (scoped now)

The user has explicitly scoped building the **face**. Plan:

1. **Admin dashboard (`apps/admin`, Next.js 15 / React 19 / Tailwind 3):**
   login → dashboard (stats) → products, orders, customers, coupons,
   currencies/FX, **settings** — all talking to the real `/api/v1` API.
2. **Customer storefront** (later): browse, cart, checkout, wallet pay.
3. Keep it connected to the real backend; no fake data in committed UI.

Design direction: clean RTL-first Arabic admin, teal (`#0f766e` / `#2dd4bf`)
+ gold accent, Tajawal/Cairo font, dark-mode aware. (This matches the preview
already shown.) There is **no external design-template skill** in this account;
design is done directly with Tailwind + good componentry.

**3D is not part of this project** — it's a digital-goods marketplace, not a
3D app. Don't add it unless the user redefines the product.

## 9. Response protocol (how I talk on this project)

The user asked that everything I say be governed by this skill. So, on Patron:

- **Answer in the user's language.** If they write Arabic, reply in Arabic.
- **Be honest and evidence-based.** Prove claims with real files/commands/output,
  not adjectives. Never call a thin preview an "achievement."
- **Never overpromise.** State what exists, what doesn't, and what's a new
  feature vs a fix. Separate "built" from "scaffold" every time.
- **No silent scope creep.** Building UI, adding CODE_POOL fulfilment, etc. are
  features — name them as such and confirm before large or irreversible work.
- **Protect the user's work.** Never propose deleting the repo; the engine is
  real and valuable. Losses that are hard to reverse get confirmed first.
- **Keep this skill current.** When we decide or discover something durable,
  edit this file in the same turn.

## 10. Deployment

- **Render (easiest, IaC):** `render.yaml` at the repo root provisions the whole
  stack in one Blueprint — `patron-db` (free Postgres), `patron-kv` (free Key
  Value / Redis, `maxmemoryPolicy: noeviction` for BullMQ), `etssadagha-api`
  (web, docker), `etssadagha-shop` (admin, docker). Runbook: `docs/DEPLOY_RENDER.md`.
  Key facts proven while building it:
  - Internal Key Value has **no password** (`ipAllowList: []`), so the API wires
    `REDIS_HOST`/`REDIS_PORT` via `fromService … property: host|port` — no code
    change (the app already reads host/port/password separately; password is just
    undefined).
  - Render **passes service env vars as Docker build args**, so the admin's
    `NEXT_PUBLIC_API_URL` (inlined by Next at build) is set as a normal env var
    and reaches `ARG NEXT_PUBLIC_API_URL` in the admin Dockerfile.
  - `generateValue` produces base64 (~44 chars) — fine for JWT/METRICS, but **not**
    for `ENCRYPTION_KEY` (needs exactly 64 hex). So `ENCRYPTION_KEY` is `sync:false`
    and generated on the user's device; don't change the crypto to accept base64.
  - Free plan covers web + Key Value, **not** workers → the fulfilment worker is
    commented out in `render.yaml` (enable on a paid plan with `dockerCommand:
    node dist/worker`).
  - Service public URL = `https://<name>.onrender.com`; distinctive names avoid
    global collisions.
- **Railway:** `docs/DEPLOY_RAILWAY.md`. **VPS:** `deploy/docker-compose.prod.yml`.
- **Self-bootstrap:** the API image's `docker-entrypoint.sh` runs `prisma migrate
  deploy` every boot and seeds once when `SEED_ON_BOOT=true`, so a fresh DB
  bootstraps with no terminal. `tsconfig.build.json` (rootDir=src) gives a flat
  `dist/` (`dist/main.js`, `dist/worker.js`, `dist/seed-runner.js`).

## 11. Pointers (deeper detail lives here)

- `CLAUDE.md` — authoritative engineering rules.
- `docs/HANDOVER.md`, `docs/IMPLEMENTATION_STATUS.md` — status & handover.
- `docs/adr/` — 22 architecture decision records (001–022). Read the relevant
  ADR before changing a subsystem; supersede with a new ADR, don't edit old ones.
- `apps/api/DATABASE.md` — data-layer notes.
- `docs/DEVELOPER_GUIDE.md`, `docs/OPERATIONS.md`, `docs/SECURITY_AUDIT.md`,
  `docs/OBSERVABILITY.md` — deep dives.
