---
name: patron-performance
description: >-
  Measure and improve Patron speed: API latency, payload size and compression,
  catalogue caching, store load time, layout shift (CLS), bundle size, database
  queries and indexes, Render free-plan cold starts. Use for "slow", "بطيء", "السرعة",
  "الأداء", before/after measurements, or when adding a heavy query or page.
---

# Patron performance

## Measure first (numbers before opinions)
- API: `curl -s -o /dev/null -w '%{time_starttransfer} %{size_download}\n' -H 'accept-encoding: gzip' <url>`;
  the catalogue page (`/catalog/products?limit=100&currency=MRU`) must stay ~40 KB gzipped
  (compression middleware in main.ts; `Cache-Control: public, max-age=60, stale-while-revalidate=300`
  on public catalogue routes).
- Store: Playwright at 390×844 with CPU ×4 and 4G throttling (CDP), cold and warm, reading
  FCP, LCP (element), CLS, transferred bytes. Targets: CLS < 0.1, LCP < 2.5 s on 4G.
- DB: `EXPLAIN (ANALYZE, BUFFERS)` on new queries with realistic rows; reports use raw SQL
  (ADR 009) with indexes (keyset, BRIN, trigram — ADR 017).

## Common fixes
- Reserve space for async content (min-height, skeletons) to stop CLS; keep the footer out of
  the first screen while data loads.
- Don't fetch the whole catalogue twice; reuse the per-currency in-memory cache
  (storefront/lib/brands.ts) and HTTP cache.
- Paginate admin lists with keyset cursors; select only needed columns; avoid N+1 (use
  `include`/`select` or one groupBy).
- Heavy work (exports, backups, reminders) in BullMQ jobs, not request handlers.
- Render free plan sleeps after 15 min: first request 30–60 s — only a paid plan fixes it.

## Verify this skill worked
A before/after table for the same pages and settings; tests still green; no regression in
another page.
