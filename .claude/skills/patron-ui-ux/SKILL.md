---
name: patron-ui-ux
description: >-
  Design and build Patron screens for phone and desktop: the customer store (Arabic
  first, French, English; RTL) and the owner dashboard (Arabic). Use for any visual
  or interaction work — new pages, redesigns, the opening splash, empty/error states,
  accessibility, translations, "تصميم", "الواجهة", screenshots for the owner. Pair with
  design-taste-frontend for visual direction.
---

# Patron UI/UX

## House rules
- **Arabic first**, RTL. Use logical Tailwind classes (`ms-/me-/ps-/pe-/start-/end-/text-start`),
  never left/right. Latin digits everywhere (`lib/format.ts`).
- Store copy goes through i18n: `useT()` in render, `tNow()` in handlers; Arabic is the key,
  French and English live in `apps/storefront/lib/i18n/dict/<area>.ts`. Check completeness from
  apps/storefront: `node <scratchpad>/i18n-check.mjs` → "all keys translated".
- Phone first: design at 390px, then 320 and 1280. Tap targets ≥ 40px. No horizontal scroll.
- Tokens: CSS variables in `app/globals.css` (`--text`, `--line`, `surface`, `surface-2`,
  brand `teal`, `gold`, `bad`, `warn`). Dark mode follows the system.
- Honest promises: manual products say "يُجهَّز بعد تأكيد الدفع", never "فوري".
- Layout stability: reserve space for async content (skeletons, `min-h`), CLS < 0.1.
- Motion: short (≤ 300 ms UI, ≤ 1.6 s splash), CSS-first, always honour
  `prefers-reduced-motion`. The splash (`components/Splash.tsx`, `discovery.css`) shows once per
  launch (sessionStorage `patron_splash`), not on navigation; tap/Escape skips it; it is
  aria-hidden and drawn over the page.
- Dashboard patterns: `surface` cards, `useFetch`, `api` client, chips from `lib/format.ts`,
  tables become cards on phones, primary action reachable without scrolling on phones.

## Procedure
1. Read the page and its data (API shape) first; keep every existing function.
2. Build; run `npx tsc --noEmit -p tsconfig.json` and `npm run lint:check` in the app.
3. Screenshots with Playwright at 390×844 and 1280×800 in ar (and fr for store pages) — look at
   each one; fix overflow, clipped Arabic, wrong direction, contrast.
4. Production build of the app (`npx next build`) before calling it done.

## Verify this skill worked
Screenshots at both widths that you inspected, i18n check clean, lint/types/build green, no
feature removed (compare routes and buttons before/after).
