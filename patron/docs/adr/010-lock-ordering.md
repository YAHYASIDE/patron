# ADR 010 — Lock acquisition ordering

**Status:** Superseded by [ADR 013](013-lock-ordering-accepted.md) — accepted and implemented · **Date:** 2026-07-22

## Context

Deadlocks happen when two transactions take the same locks in opposite orders.
Two paths in Patron lock more than one row:

- **Wallet payment:** `wallets` (FOR UPDATE) → `orders` → `payments`
- **Refund to wallet:** `refunds` → `payments` → `orders` → `wallets`

These acquire the wallet/order pair in **opposite** order. A wallet payment and
a wallet refund for the same user, running concurrently, can deadlock. Postgres
detects it and aborts one side, which surfaces to the customer as a 500.

The window is small in practice — refunds are staff-initiated and an order being
paid is not simultaneously being refunded — but "small" is not "impossible", and
this class of bug is unreproducible when it does happen.

## Decision (proposed)

Establish a single global lock order, applied everywhere:

```
wallet → order → payment → refund
```

`RefundsService.process` takes the wallet lock first, before touching the refund
row, even when the refund is not going to the wallet.

## Why this is Proposed rather than Accepted

Taking the wallet lock unconditionally changes refund behaviour under
contention: a card refund would briefly serialise against wallet activity for
the same user, where today it does not. That is a behaviour change to a
money-moving path, so it wants a deliberate decision rather than a quiet
refactor.

## Consequences if accepted

- Deadlock on this pair becomes impossible rather than unlikely.
- Card refunds serialise against wallet operations for the same customer. At
  current volumes this is unmeasurable.
- The convention must be documented where developers will see it, and any new
  multi-row-locking path reviewed against it.

## Alternative considered

Retry on deadlock (Postgres error `40P01`) with backoff. Rejected as the primary
fix: it converts a design flaw into latency and hides the ordering problem.
Worth adding as a safety net *after* the ordering is fixed, not instead of it.
