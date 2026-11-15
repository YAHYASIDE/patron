# Live shop check

`check.mjs` checks the **live** shop on Render the way a customer sees it, with a
real Chromium. It is plain Node + Playwright (no test runner) and has its own
`package.json`, outside the npm workspaces.

## What it checks

1. **Wakes the services** (Render free tier sleeps after 15 idle minutes): polls
   API `/health/ready`, store `/` and dashboard `/login` until 200, up to 4 min.
2. **API**: `/catalog/rates` has MRU, XOF, DZD and EUR > 0; `/catalog/stats`
   answers; `/payments/manual-accounts` lists Bankily, Masrvi, Sedad, Klic,
   BIM Bank, Nita (22227268) and Orange Money (74646158), and no enabled account
   has an empty number; `/catalog/banners` is an array; `/catalog/games` has at
   least 20 brands.
3. **Store pages** as a guest, at 320, 390 and 1280 px, in Arabic and French:
   `/`, `/products`, `/brands/g-pubg-mobile`, `/brands/g-usdt-binance`,
   `/login`, `/cart`, `/help`, `/terms`. Each page: HTTP status < 400, no
   JavaScript page error, no "Application error", not wider than the screen, no
   text closer than 8 px to the left/right edge, Latin digits only, and
   `<html lang dir>` matching the language. Also: the home page shows the brand
   grid, the PUBG page shows its packages (and "قبل الدفع" in Arabic), and the
   sign-in page shows the WhatsApp number field.
4. **Opening screen**: `.splash` shows on a first visit and is gone after 3 s.
5. **PWA files**: `/manifest.webmanifest`, `/sw.js`, `/offline.html`,
   `/icons/icon-192.png`.
6. **Dashboard**: `/login` shows the sign-in form at 390 px with no page error
   (it never signs in).

Results go to `out/`: `report.md` (summary and a table of failures) and a
screenshot of every failing page. The script exits 1 when anything failed.

## Run it locally

```bash
cd tests/live
npm ci
npx playwright install chromium   # once
STORE_URL=http://localhost:3002 \
ADMIN_URL=http://localhost:3001 \
API_URL=http://localhost:3010/api/v1 \
node check.mjs
```

Without the env vars it checks the live Render URLs. Optional:
`CHROMIUM_PATH` (use an existing Chromium/headless_shell instead of
Playwright's download), `WAKE_TIMEOUT_MS` (default 240000), `MIN_GAMES`
(default 20).

## Run it on GitHub

`.github/workflows/live-check.yml` runs ~12 minutes after every push to the
deploy branch that touches an app (time for Render to deploy), daily at 05:17
UTC, and on demand from **Actions → Live shop check → Run workflow**. GitHub
only offers the daily run and the button once the workflow is on the default
branch (main); until then the push trigger is what runs it. The report and screenshots are in
the run's `live-check` artifact (kept 14 days); on failure the report is also
posted on the deploy branch's open pull request, or on the issue
"فحص المتجر الحي فشل / Live shop check failed" when there is no open PR.
