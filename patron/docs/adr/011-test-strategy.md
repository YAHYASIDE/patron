# ADR 011 — Test strategy: real database, HTTP-level provider stubs

**Status:** Accepted · **Date:** 2026-07-22

## Context

The failures that cost money in this system are not logic errors in a pure
function. They are: two concurrent requests both creating an order, a webhook
delivered twice, a transaction that should have rolled back but didn't, a
provider timing out halfway through a purchase.

A mocked Prisma cannot exhibit any of them.

## Decision

Three tiers, split by what they can actually prove:

**Unit** — pure logic with no I/O: the state machine, money rounding, pricing
conversion, the permissions guard, idempotency claim semantics, provider
failover decisions. Fast, run on every save.

**Integration** — a real Postgres via testcontainers. This is where CHECK
constraints, unique indexes, `FOR UPDATE` locking and transaction rollback are
exercised. Concurrency tests use `Promise.allSettled` on genuinely parallel
calls and assert on the *database* afterwards, not on the return values.

**E2E** — the full HTTP stack, with providers stubbed at the network boundary
using `nock` rather than mocked in the DI container. Adapter serialisation,
timeout handling and error mapping are then exercised exactly as in production.

## The tests that must never be deleted

- Concurrent order creation from one quote → exactly one order exists.
- Replayed payment capture → exactly one `order.paid` outbox event.
- Concurrent wallet debits → the second is rejected, balance is correct.
- Non-retryable provider error → the second provider is *not* called.
- Rolled-back transaction → no outbox event is claimable.

Each corresponds to a way the platform could charge a customer twice or pay a
provider twice.

## Consequences

- Integration tests need Docker and take ~60s to spin up. Worth it.
- `maxWorkers: 1` for integration and e2e: parallel workers against one database
  produce flakes that look like concurrency bugs and waste hours.
- Coverage thresholds (80% lines, 70% branches) apply to the unit tier only.
  Chasing a coverage number in integration tests optimises for the wrong thing.
