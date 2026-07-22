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

## Conventions

Project-wide engineering rules live in [`CLAUDE.md`](./CLAUDE.md).

> **Note on features:** this repository is currently the project *scaffold*.
> `apps/api` carries the existing backend; the admin and mobile apps are
> structural scaffolds with no business features yet.
