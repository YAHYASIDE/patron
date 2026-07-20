# ADR 006 — Order status is derived, not assigned

**Status:** Accepted · **Date:** 2026-07-20

## Context

A multi-item order can be partly delivered. If any code path can assign
`status = COMPLETED` directly, the aggregate eventually disagrees with its
items — a refunded order that still displays as delivered, and a support ticket
nobody can reproduce.

## Decision

`deriveOrderStatus(itemStatuses)` computes the order status from its items, and
`syncStatus()` is called after every fulfilment attempt. Transitions are
validated against an explicit table; an illegal transition throws rather than
being silently applied.

## Consequences

- The aggregate can never contradict its parts.
- `PARTIALLY_COMPLETED` is a real state with defined behaviour, not an edge case
  discovered in production.
- Terminal states (`COMPLETED`, `REFUNDED`, `CANCELLED`) cannot be re-entered,
  so a late-arriving provider webhook cannot revive a refunded order.
- A retry from `FAILED` back to `PROCESSING` is explicitly allowed, because
  operators need it.
