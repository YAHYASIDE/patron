---
name: patron-discovery
description: >-
  Run, extend and trust the Patron Discovery Engine (tools/discovery): read-only checks of code,
  tests, error logs and dependency audits that produce deduplicated DiscoveryInput records for the
  intelligence center, plus the in-app scanners and the daily GitHub workflow. Use for "افحص
  المشروع", "اكتشافات", "discovery", adding a new check, a false positive, or wiring the scan to the
  dashboard with INTEL_INGEST_TOKEN.
---

# Patron discovery engine

Contract: `docs/contracts/intelligence-api.md`. CLI docs: `tools/discovery/README.md`.

## 1. Run it

```bash
node tools/discovery/index.mjs --root . --out report.json --md report.md      # read-only
INTEL_API_URL=…/api/v1 INTEL_INGEST_TOKEN=… node tools/discovery/index.mjs --ingest
```

In the app, `POST /admin/intelligence/scan` (or the daily job at 03:17 UTC) runs the five
scanners: catalog-readiness, payments-by-country, market-staleness, server-errors, search-gaps.
GitHub runs `.github/workflows/intelligence.yml` daily — **only from the default branch**
(`main`), so it starts once this work reaches `main`.

## 2. Add a check

1. New module in `tools/discovery/checks/<name>.mjs` returning `discovery(check, key, fields)`
   records (`lib/discovery.mjs`). The key is stable (path, route, id, content hash) — never a line
   number. Fingerprints are normalised to the API pattern `[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,199}`.
2. `verified: true` only for facts read straight from the code; heuristics are `false` with an honest
   confidence. Kinds/evidence types must be ones the API accepts
   (`apps/api/src/modules/intelligence/intelligence.types.ts`).
3. A fixture under `tools/discovery/test/fixtures/known-issues` that the check MUST catch, and the
   `clean` fixture that must stay empty. Run it on the real repo and remove false positives before
   committing.
4. Scrub everything (`lib/scrub.mjs`): no phone/account numbers, e-mails, tokens.

## 3. Reading results honestly

A finding is a claim with evidence, not a verdict. Before calling a HIGH real, open the cited
`file:line` and trace a real caller (INTEL-001 was HIGH by the rule but the routes were already
behind the JWT guard; the real issue was the pattern). Report «مؤكد» vs «تقدير» as the data says.

## 4. Known limits

- `lib/source.mjs` splits classes/methods by braces; a `{` inside a regex literal can hide the
  routes after it (reported in INTEL-001, see the PR follow-ups).
- Admin-route check reads decorators by text: `@RequirePermissions(...EMPTY)` spread from an empty
  array would count as guarded.
