---
name: patron-live-tester
description: >-
  Run the Patron shop for real (API + store + dashboard on a throwaway database) and
  test the customer journey in a browser: sign in, browse, cart, checkout, manual
  transfer with receipt, owner approval, delivery, wallet payment, refunds. Use for
  "test the shop", "اختبر المتجر", "رحلة الشراء", screenshots, or proving a fix works
  end to end. Never against production data.
---

# Patron live tester

## Stack (local, throwaway)
```bash
service postgresql start; redis-cli ping || redis-server --daemonize yes
export PGPASSWORD=patron
psql -h 127.0.0.1 -U patron -d postgres -c "DROP DATABASE IF EXISTS patron_live_test" -c "CREATE DATABASE patron_live_test"
cd apps/api && export DATABASE_URL=postgresql://patron:patron@127.0.0.1:5432/patron_live_test
npx prisma migrate deploy && npm run build
node dist/seed-runner.js && node dist/catalog-pack-runner.js     # needs SEED_ADMIN_PASSWORD, ENCRYPTION_KEY
PORT=3010 node dist/main.js &                                    # API at /api/v1
cd ../storefront && NEXT_PUBLIC_API_URL=http://localhost:3010/api/v1 npx next build && npx next start -p 3002 &
cd ../admin && NEXT_PUBLIC_API_URL=http://localhost:3010/api/v1 npx next dev -p 3001 &
```
If `next build` fails with "Can't resolve '../lib/is-error'", remove `apps/<app>/node_modules`
and `.next` and rebuild. If it fails fetching Google Fonts, retry (network).

## Journeys
- `tests/live/checkout-flow.mjs` (STORE_URL, API_URL, SEED_ADMIN_PASSWORD, CHROMIUM_PATH=/opt/pw-browsers/chromium):
  hidden product in cart, transfer with receipt → owner approval → PAID, wrong player ID in
  Arabic, wallet payment, earlier purchases. Expect "14/14 passed".
- Money checks: three simultaneous wallet payments (one succeeds, charged once), failed
  delivery → FAILED + customer notice + dashboard alert, late delivery alert after 15 min,
  refund to wallet, second refund refused.
- `tests/live/check.mjs` is the read-only smoke check of the LIVE site (runs in GitHub
  Actions after a push to the deploy branch; this container cannot reach onrender.com).

## Screenshots
Playwright (`playwright-core`, Chromium at /opt/pw-browsers) at 390×844 and 1280×800, Arabic
cookie `patron_lang=ar`, splash skipped with sessionStorage `patron_splash=1`. Save under
`docs/<topic>-shots/`. Look at every screenshot before reporting it.

## Rate limits
`POST /auth/phone/request-code` allows 3 per 5 min per IP (in-memory throttler): restart
the local API instead of waiting.

## Verify this skill worked
Report each journey as N/N passed with the script output, plus screenshot paths you looked at.
