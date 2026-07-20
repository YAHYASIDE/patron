# ADR 001 — Checkout quote with a 15-minute price lock

**Status:** Accepted · **Date:** 2026-07-20

## Context

Between a customer seeing a price and paying it, four things can move: the
catalog sell price, the provider's cost, the FX rate, and (once enabled) the tax
rate. Reading any of them again at payment time produces one of two failures:
the customer is charged something they did not agree to, or we sell below cost.

On a pair like USD/XOF at roughly 604:1, a 2% intraday move is a real loss on
every order in flight.

## Decision

Checkout is a two-step flow. `POST /checkout/quotes` produces a `CheckoutQuote`
that freezes sell price, provider cost, FX rate and tax, valid for 15 minutes.
`POST /checkout/orders` consumes a quote and copies every value verbatim —
the order pipeline performs no pricing arithmetic at all.

Consumption is a conditional `UPDATE ... WHERE status = 'ACTIVE' AND expiresAt > now()`.
Only one request can win, so a double-tapped checkout yields one order even if
the idempotency layer is bypassed.

## Consequences

- The customer always pays what they were shown; margin is known before payment.
- Every order carries `totalCostBase` from its quote, so per-order margin is a
  column, not a reconstruction.
- Quotes accumulate; a sweeper expires them every minute.
- Stock is **not** reserved at quote time. Reserving would let anyone lock the
  entire code inventory for 15 minutes for free. The trade-off is that a quote
  can fail at fulfilment if inventory sells out first — allocation happens under
  a row lock at fulfilment, which is the authoritative point.
- 15 minutes is a business parameter. Shorter reduces FX exposure; longer is
  friendlier on slow mobile connections.
