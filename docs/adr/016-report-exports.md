# ADR 016 — CSV export written by hand

**Status:** Accepted · **Date:** 2026-07-23

## Context

Finance teams live in spreadsheets. Exports need to be correct in Excel
specifically, which is a narrower and stranger requirement than "valid CSV".

## Decision

A ~40-line `ReportExportService` rather than a CSV library, handling three
things libraries commonly get wrong:

1. **Formula injection.** A cell starting with `=`, `+`, `-` or `@` is executed
   by Excel and Google Sheets. A product name of
   `=HYPERLINK("http://evil.test","Click")` runs on the finance team's machine.
   This is exploited in the wild, and most CSV libraries do not defend against
   it because it is an application-level concern.
2. **UTF-8 BOM.** Without it, Excel renders Arabic product names as mojibake and
   someone concludes the export is broken.
3. **CRLF line endings**, which older Excel builds still expect.

Exports stream as attachments rather than returning JSON for a client to
convert — browser-side conversion is one more place to get encoding wrong.

## Consequences

- No dependency, and the escaping rules are visible and testable.
- Very large exports are built in memory. Acceptable at report sizes (capped at
  400 days and 200 rows); a genuinely large export should stream rows instead.
- The tab prefix on formula-shaped cells is visible in the spreadsheet. A
  deliberate trade: mildly ugly beats remotely exploitable.
