# Patron

Production-ready monorepo for the **Patron** platform, managed with
[Turborepo](https://turbo.build/repo).

## Stack

| Layer          | Technology                              |
| -------------- | --------------------------------------- |
| Monorepo       | Turborepo + npm workspaces              |
| Backend API    | NestJS + Prisma + BullMQ                |
| Database       | PostgreSQL 16                           |
| Admin dashboard| Next.js (App Router) + Tailwind CSS     |
| Mobile app     | Flutter                                 |
| Containers     | Docker / docker-compose                 |

## Layout

```
patron/
├── apps/
│   ├── api/          NestJS backend (Prisma, PostgreSQL, BullMQ)
│   ├── admin/        Next.js admin dashboard
│   └── mobile/       Flutter mobile app
├── packages/
│   ├── tsconfig/     Shared TypeScript base configs (@patron/tsconfig)
│   └── types/        Shared TS type contracts (@patron/types)
├── deploy/           Kubernetes, nginx, prod compose, ops scripts
├── docs/             Architecture decision records & operations docs
├── docker-compose.yml   Local dev stack (postgres, redis, + apps profile)
├── turbo.json        Turborepo task pipeline
└── package.json      Workspace root
```

> The Flutter app (`apps/mobile`) uses the Flutter toolchain and sits
> outside the npm/Turborepo task graph. See `apps/mobile/README.md`.

## Getting started

```bash
# 1. Install JS/TS workspace dependencies
npm install

# 2. Start local infrastructure (PostgreSQL + Redis)
docker compose up -d

# 3. Configure environment
cp .env.example apps/api/.env         # backend
cp apps/admin/.env.example apps/admin/.env   # dashboard

# 4. Prepare the database (from apps/api)
npm run prisma:generate --workspace=@patron/api
npm run prisma:migrate  --workspace=@patron/api

# 5. Run everything in dev mode
npm run dev            # turbo runs each app's dev task
```

The API listens on `:3000`, the admin dashboard on `:3001`.

## Common tasks

Run from the repo root; Turborepo fans them out across workspaces:

```bash
npm run build        # build all apps/packages
npm run dev          # run all dev servers
npm run lint         # lint (autofix)
npm run lint:check   # lint (no autofix, CI mode)
npm run typecheck    # type-check every workspace
npm run test         # run test suites
npm run format       # prettier --write across the repo
```

Target a single workspace with npm's `--workspace` flag, e.g.
`npm run test --workspace=@patron/api`.

## Docker

Each deployable app ships a self-contained multi-stage `Dockerfile`:

- `apps/api/Dockerfile` — build context `apps/api`
- `apps/admin/Dockerfile` — build context `apps/admin`

Bring the whole stack up locally (builds images):

```bash
docker compose --profile apps up --build
```

## Project status

_As of commit `8fa4666` — all 9 GitHub Actions checks green._

| Part | Status |
|---|---|
| `apps/api` (NestJS backend) | Core commerce complete and test-covered; Identity & Access hardened (Sprint 1). |
| `apps/admin` (Next.js) | Structural scaffold — builds/lints clean, no business features yet. |
| `apps/mobile` (Flutter) | Structural scaffold — analyzes/tests clean, no business features yet. |

Backend quality gates: **853 tests** (794 unit / 32 integration / 27 e2e), unit
coverage **93% lines / 92% functions / 87% branches**, `npm audit` **clean**, and
a Docker image built + Trivy-scanned in CI.

## Documentation

| Doc | Purpose |
|---|---|
| [`docs/HANDOVER.md`](./docs/HANDOVER.md) | Project handover: status, architecture, roadmap, lessons learned. **Start here.** |
| [`docs/IMPLEMENTATION_STATUS.md`](./docs/IMPLEMENTATION_STATUS.md) | Module-by-module what's built / functional / scaffold. |
| [`docs/DEVELOPER_GUIDE.md`](./docs/DEVELOPER_GUIDE.md) | Onboarding, coding standards, how to add a provider/gateway/product. |
| [`docs/adr/README.md`](./docs/adr/README.md) | Architecture Decision Records (the *why*). |
| [`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md) | Pre-launch blockers and subsystem scores. |
| [`docs/OPERATIONS.md`](./docs/OPERATIONS.md) · [`DISASTER_RECOVERY.md`](./docs/DISASTER_RECOVERY.md) · [`OBSERVABILITY.md`](./docs/OBSERVABILITY.md) · [`SECURITY_AUDIT.md`](./docs/SECURITY_AUDIT.md) | Run, recover, observe, and secure the system. |
| [`apps/api/DATABASE.md`](./apps/api/DATABASE.md) | Data-layer conventions. |

## Conventions

Project-wide engineering rules live in [`CLAUDE.md`](./CLAUDE.md).
