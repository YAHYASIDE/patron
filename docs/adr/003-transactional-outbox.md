# ADR 003 — Transactional outbox for side effects

**Status:** Accepted · **Date:** 2026-07-20

## Context

A paid order must trigger fulfilment. Enqueueing directly from the service has
two failure windows:

- Push, then the transaction rolls back → a worker fulfils an order that does
  not exist, and we pay a provider for nothing.
- Commit, then the process dies before the push → a paid order is never
  fulfilled, and nothing in the system knows.

Both are silent. Neither is rare at volume.

## Decision

State changes write an `OutboxEvent` in the same transaction. A relay polls
committed events every second and publishes them to BullMQ, claiming batches
with `FOR UPDATE SKIP LOCKED` so multiple relay instances can run.

## Consequences

- A committed order always has its job; a rolled-back one never does.
- Delivery is at-least-once. Exactly-once across two systems does not exist, so
  **every processor must be idempotent** — enforced by deriving BullMQ `jobId`
  from the event and by conditional-update claims in the engine.
- Up to one second of added latency on fulfilment. Acceptable: the customer is
  already on a "processing" screen.
- Failed events back off exponentially and park in `DEAD` after 8 attempts for
  manual inspection, rather than retrying forever.
