---
name: patron-admin
description: >-
  Build and change the Patron owner dashboard (apps/admin, Next.js App Router,
  Arabic): orders and refunds, customers and wallets, products and stock, reports,
  payment methods, settings and backups, notification center, USDT, agents, bank
  notices, account recovery. Use for "لوحة الإدارة", "لوحة التحكم", "dashboard",
  new admin pages or admin API routes.
---

# Patron admin dashboard

## Structure
- Pages: `apps/admin/app/(app)/<section>/page.tsx`; menu in `app/(app)/layout.tsx` (NAV array,
  icons by name); header holds `StaffBell` (notification center) and `AlertsButton` (sounds).
- Data: `lib/api.ts` (`api.get/post/put/patch/del/download`, tokens in localStorage
  `patron.access`/`patron.refresh`), `lib/hooks.ts` (`useFetch(path)` → {data, loading, error, reload}),
  formatting and status chips in `lib/format.ts`. Feature clients may live in their own files.
- API: staff routes under `/admin/*` in `apps/api/src/modules/**`, guarded with
  `@RequirePermissions(...)`; super_admin bypasses. Audit staff writes.

## UI rules
Arabic only, RTL, Latin digits; `surface` cards; phone first (390px): tables turn into cards,
the main action (approve, deliver, refund) is visible without scrolling; never show secrets
(codes masked, no passwords, no OTPs except the owner-relay page by design). Dangerous actions
(refund, reject, payout, USDT complete) ask for confirmation and show the amount.

## Procedure
1. API first with DTO validation, permission, audit, unit tests.
2. Page with loading/empty/error states; reuse components (Notice, ExportButton, charts, PayLogo).
3. `npx tsc --noEmit -p tsconfig.json`, `npm run lint:check`, `npx next build` in apps/admin.
4. Screenshots at 390 and 1280 (see patron-live-tester) and look at them.

## Verify this skill worked
Route guarded (403 without the permission in an e2e test), page works on both widths, build green.
