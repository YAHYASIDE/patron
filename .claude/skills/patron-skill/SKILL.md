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
- **Admin (`apps/admin`): Next.js scaffold.** Structure only, no real screens yet.
- **Mobile (`apps/mobile`): Flutter scaffold.** Structure only.

The gap the user feels ("there's nothing to see") is real and expected: the
work went into the **engine**, not a visible **face**. Building the face is the
next phase and is now explicitly scoped.

## 2. Repository shape

Turborepo + npm workspaces. Drive everything from the **repo root**.

```
apps/api      NestJS 11 + Prisma 6 + PostgreSQL 16 + Redis/BullMQ   (built)
apps/admin    Next.js 15 (App Router) + React 19 + Tailwind 3       (scaffold)
apps/mobile   Flutter                                               (scaffold)
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
games, 7 products, providers, coupon `WELCOME10` (10% off, min order 25),
templates, settings.

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

## 10. Pointers (deeper detail lives here)

- `CLAUDE.md` — authoritative engineering rules.
- `docs/HANDOVER.md`, `docs/IMPLEMENTATION_STATUS.md` — status & handover.
- `docs/adr/` — 22 architecture decision records (001–022). Read the relevant
  ADR before changing a subsystem; supersede with a new ADR, don't edit old ones.
- `apps/api/DATABASE.md` — data-layer notes.
- `docs/DEVELOPER_GUIDE.md`, `docs/OPERATIONS.md`, `docs/SECURITY_AUDIT.md`,
  `docs/OBSERVABILITY.md` — deep dives.
