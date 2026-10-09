# Deploying Patron on Railway

A step-by-step runbook for a first production deploy of Patron to
[Railway](https://railway.app), done from a **computer** (far easier than a
phone). Railway runs the app, its PostgreSQL, and its Redis for you, gives each
service HTTPS automatically, and connects a custom domain with one DNS record.

> **Security first — read `SECURITY.md` rules below before you paste anything.**
> Never paste real secrets or a database connection string into a chat (AI or
> otherwise). Generate secrets locally or in Railway's own UI, and run
> migrations/seed through `railway run` so the DB URL is injected, never shown.

The repo already ships everything needed: `apps/api/Dockerfile`,
`apps/admin/Dockerfile` (now accepts a `NEXT_PUBLIC_API_URL` build arg), and
`deploy/docker-compose.prod.yml` for the VPS alternative.

---

## 0. Prerequisites

- A Railway account, logged in with the **GitHub** account that owns `patron`.
- On your computer: `git`, Node 22+, and the **Railway CLI**
  (`npm i -g @railway/cli`, then `railway login`). The CLI is only needed for
  the one-time migrate/seed in step 6.
- Deploy from branch **`claude/patron-monorepo-setup-1o2gl7`** (or merge it to
  `main` first and deploy `main`). The default `main` is behind and will fail.

## 1. Create the project + databases

1. Railway → **New Project**.
2. **+ New** → **Database** → **PostgreSQL**.
3. **+ New** → **Database** → **Redis**.

You should see three items in the project: the app (added next), **Postgres**,
and **Redis**.

## 2. The API service

1. **+ New** → **GitHub Repo** → `YAHYASIDE/patron`.
2. Service **Settings → Source**:
   - **Root Directory** = `apps/api`
   - **Branch** = `claude/patron-monorepo-setup-1o2gl7`
3. Service **Settings → Networking** → **Generate Domain**. Note the URL it
   gives (e.g. `patron-api-production.up.railway.app`) — this is the API's
   public address.
4. Service **Variables** → add these. The `${{...}}` references link the
   databases automatically (they resolve only if the services are named
   `Postgres` and `Redis`):

   ```
   NODE_ENV=production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_HOST=${{Redis.REDISHOST}}
   REDIS_PORT=${{Redis.REDISPORT}}
   REDIS_PASSWORD=${{Redis.REDISPASSWORD}}
   BASE_CURRENCY=USD
   OTEL_ENABLED=false
   CORS_ORIGINS=https://shop.etssadagha.com
   ```

   Then add the **four secrets**, generated so they never pass through a chat.
   On your computer:

   ```bash
   echo "JWT_ACCESS_SECRET=$(openssl rand -base64 36)"
   echo "JWT_REFRESH_SECRET=$(openssl rand -base64 36)"
   echo "ENCRYPTION_KEY=$(openssl rand -hex 32)"   # exactly 64 hex chars
   echo "METRICS_TOKEN=$(openssl rand -hex 16)"
   ```

   Paste each line's value into the matching Railway variable. (Railway's Raw
   Editor lets you paste all variables at once.)

## 3. The worker service (automatic fulfilment)

1. **+ New** → **GitHub Repo** → `YAHYASIDE/patron` again.
2. **Settings → Source**: Root Directory = `apps/api`, same branch.
3. **Settings → Deploy → Custom Start Command** = `node dist/worker`.
4. **Variables**: the same set as the API (reference the same DB/Redis and
   reuse the same secret values). No domain needed.

*(Optional for a first trial: skip the worker to save resources. Orders will
sit unfulfilled until it runs, but the dashboard and catalog work.)*

## 4. The admin (dashboard) service

1. **+ New** → **GitHub Repo** → `YAHYASIDE/patron`.
2. **Settings → Source**: Root Directory = **`apps/admin`**, same branch.
3. **Variables** (this is **build-time** — Next.js inlines it, and the
   Dockerfile now reads it as a build arg):

   ```
   NEXT_PUBLIC_API_URL=https://<API-domain-from-step-2>/api/v1
   ```

4. **Settings → Networking → Custom Domain** → enter `shop.etssadagha.com`.
   Railway shows a **CNAME target** (e.g. `xxxx.up.railway.app`).

## 5. DNS (one record)

In the DNS panel for **etssadagha.com**, add a single **CNAME** record:

| Type | Name/Host | Value/Target |
|------|-----------|--------------|
| CNAME | `shop` | *(the target Railway showed in step 4)* |

The API uses its free `*.up.railway.app` domain, so it needs no DNS record.

## 6. Migrations + seed (once, securely)

The production image has no `ts-node`/`prisma` CLI, so run these from your
checkout through the Railway CLI, which injects `DATABASE_URL` **without
printing it**:

```bash
# in your local patron checkout, on the API service:
railway link           # pick the project + the API service
railway run npx prisma migrate deploy
railway run npx prisma db seed
```

Set `SEED_ADMIN_PASSWORD` as a **variable on the API service** first (not on the
command line, not in chat); the seed reads it from the injected env.

## 7. Verify

- `https://<API-domain>/api/v1/health/ready` returns `200`.
- `https://shop.etssadagha.com` opens the login page.
- Log in with `admin@patron.io` and the `SEED_ADMIN_PASSWORD` you set.

---

## Security notes (do not skip before a real launch)

- **Secrets never through chat.** Generate with `openssl` locally or Railway's
  UI. If any secret was ever pasted into a conversation, treat it as burned and
  rotate it.
- **Database URL never through chat.** Use `railway run` / Railway's web Shell;
  both inject it without display.
- **Rotate** all secrets once before taking real customers/payments.
- **Payments:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are not set
  here. Add them (as Railway variables) only when wiring real payments, and
  point the Stripe webhook at `https://<API-domain>/api/v1/webhooks/...`.
- See `docs/SECURITY_AUDIT.md` and `docs/DISASTER_RECOVERY.md`.

## Required environment variables (source of truth)

From `apps/api/src/config/env.validation.ts`:

| Variable | Rule |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | ≥ 32 chars |
| `JWT_REFRESH_SECRET` | ≥ 32 chars |
| `ENCRYPTION_KEY` | exactly 64 hex chars (32 bytes) |
| `BASE_CURRENCY` | 3 letters, optional (default `USD`) |
| `METRICS_TOKEN` | ≥ 16 chars, **required in production** |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | from the Redis service |
| `CORS_ORIGINS` | the admin's public origin, e.g. `https://shop.etssadagha.com` |
| `PORT` | injected by Railway automatically |

## Alternative: VPS (Docker Compose)

If you later get a VPS with a public IP, `deploy/docker-compose.prod.yml` runs
the whole stack (postgres + redis + migrate + api + worker + nginx +
otel-collector) on one host. Point an **A record** for `shop.etssadagha.com` at
the IP, set `server_name shop.etssadagha.com;` in `deploy/nginx/nginx.conf`, add
a certbot container for TLS, fill `deploy/.env` with the same secrets, then
`docker compose -f deploy/docker-compose.prod.yml up -d`.
