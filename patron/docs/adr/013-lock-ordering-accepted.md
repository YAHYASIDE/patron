# ADR 013 — Lock ordering, implemented

**Status:** Accepted · **Date:** 2026-07-23 · **Supersedes the Proposed status of ADR 010**

## Decision

The global lock order proposed in [ADR 010](010-lock-ordering.md) is adopted:

```
wallet → order → payment → refund
```

Enforced by `common/locking/lock-order.ts`. Callers pass resources in whatever
order reads naturally; `acquireLocks()` sorts by rank. Ids are sorted *within* a
rank too — two transactions locking the same pair of wallets could otherwise
still deadlock against each other, which is the bug one level down that a naive
implementation misses.

## Implementation notes

`RefundsService.process` takes the wallet lock **unconditionally**, including for
card refunds that will never touch a balance. A conditional lock is a lock
ordering that depends on data, which is the same bug wearing a disguise.

`PaymentsService.markCaptured` reads the payment row to learn its order id, then
acquires order-before-payment before either row is *modified*. Reading is not
locking; the ordering constraint applies to lock acquisition.

## Consequences

- Deadlock on the wallet/order pair is now impossible rather than unlikely.
- Card refunds serialise briefly against wallet activity for the same customer.
  Unmeasurable at current volumes.
- Any new path locking rows in more than one of these tables must extend
  `LockRank` rather than inventing a local ordering. This is the kind of
  convention that decays silently, so `resilience/lock-ordering.spec.ts` runs
  ten concurrent opposing transactions and asserts zero deadlocks.

## Rejected alternative

Retry on Postgres error `40P01` with backoff. Rejected as the primary fix: it
converts a design flaw into latency and hides the ordering problem. Reasonable
as a safety net *after* correct ordering, not instead of it.
