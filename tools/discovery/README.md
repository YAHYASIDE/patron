# Patron Discovery Engine (CLI)

A dependency-free Node 20+ CLI that scans the repository **read-only** and reports findings as
`DiscoveryInput` records (see `docs/contracts/intelligence-api.md`). It only writes the report files
you name, and it can send the run to the intelligence API.

```bash
node tools/discovery/index.mjs [--root .] [--out report.json] [--md report.md] \
  [--logs <file>] [--audit [label=]<npm-audit.json>]... [--trigger manual|schedule|ci] [--ingest]
```

Without `--out` the JSON goes to stdout. Exit code: 0 = ran (findings or not), 1 = a check crashed
(status `FAILED`), 2 = ingest failed, 64 = bad arguments.

## Checks (`checks/*.mjs`)

| Check | Fingerprint | Severity / kind | Verified |
|---|---|---|---|
| `.only` / `fit` / `.skip` / `xit` / `xdescribe` in test files under `apps/` | `focused-test:<file>:<call>:<hash of test name>` | HIGH (focused), LOW (skipped) / test | yes |
| Admin routes (`admin/...`) with no `@RequirePermissions(...)`, `@RequireAnyPermission(...)`, `@Public()` or `@Roles()` on the method or class (an empty one counts as none) | `admin-route-no-permission:<VERB> /<path>` | HIGH / security | yes |
| API modules that no file in `apps/api/test/unit` imports (placeholder modules skipped) | `module-without-unit-test:<module>` | LOW / quality | yes |
| Store texts missing from the fr/en dictionaries, or with different `{placeholders}` | `i18n-missing:<file>`, `i18n-placeholders:<file>` | LOW, MEDIUM / ux | yes |
| TODO / FIXME / HACK comments in `apps/*/{src,app,lib}` (one per file) | `todo-marker:<file>` | LOW / quality | yes |
| Manual accounts with empty `countries`; Mauritanian methods (Bankily, Masrvi, Sedad, Click/Klic, BIM Bank) listed for a non-MR country | `payment-country:...:<id>` | MEDIUM / payment | yes |
| Region-locked SKUs (`-US-`, `-UK-`...) in catalog packs with no market rule | `region-locked-sku:<region>` | LOW / opportunity | no |
| `--logs`: repeated error lines grouped by a normalized form, top 20 | `log-error:<hash>` | by count / bug | no |
| `--audit`: `npm audit --json` results, one per advised package | `dependency-audit:<app>:<package>` | from npm / security | yes |

The fingerprint is check name + a stable key (path, route, id or content hash), never a line number,
so the API counts a repeat instead of adding a row. Every string is scrubbed before output (phone
and account numbers, e-mails, long tokens, JWTs, `key=` / `token=` / `password=` values).

## Ingest

`--ingest` posts the JSON to `${INTEL_API_URL}/admin/intelligence/ingest` (the URL includes
`/api/v1`) with header `x-intel-token: ${INTEL_INGEST_TOKEN}`. When either variable is unset it skips
with a message. The token and URL are never printed.

## Tests

```bash
node --test tools/discovery/test/*.test.mjs
```

`test/fixtures/known-issues` holds a repo the checks must flag (a `.only` test, admin routes without
a permission, etc.); `test/fixtures/clean` must produce no discovery. Sensitive-looking test values
are generated at run time.

`.github/workflows/intelligence.yml` runs this daily and uploads `report.json` / `report.md`.
