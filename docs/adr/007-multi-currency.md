# ADR 007 — Multi-currency: base pricing, manual overrides, frozen rates

**Status:** Accepted · **Date:** 2026-07-20

## Context

Patron sells in USD, EUR, MRU and XOF. Two properties of these currencies drive
the design: XOF has no minor unit (charging 2,500.75 CFA is meaningless), and
USD/XOF sits near 604:1, so conversion produces prices no customer recognises —
2,847 CFA is a conversion artifact, not a price.

## Decision

Products are priced in the base currency (USD). Other currencies resolve in this
order:

1. A manual `ProductPrice` override for that currency — always wins.
2. Otherwise: base price × live `FxRate` × configurable markup, then rounded per
   `Currency.decimals` and optional `roundingStep`.

`FxRate` is append-only; a new rate supersedes the old rather than overwriting.
Orders, payments, quotes and refunds all store the `fxRate` and `fxRateId` used.

## Consequences

- Historic orders are reproducible at the rate they were actually priced with.
- Refunds use the order's original rate, so the customer is not handed an FX
  gain or loss they never agreed to.
- Prices in XOF and MRU look like prices, because a human set them.
- A rate moving more than 15% is recorded **inactive** and alerts — that is far
  more often a broken feed than a real devaluation, and pricing keeps using the
  last trusted rate until an operator confirms.
- Overrides need maintaining: a base price change does not propagate to a
  currency that has one. This is a deliberate trade of automation for control.
- VAT is not implemented, but `taxAmount`/`taxRate`/`taxInclusive` exist and flow
  through every total calculation, so enabling it is configuration plus
  calculation logic — no migration, no rewrite of historic orders.
