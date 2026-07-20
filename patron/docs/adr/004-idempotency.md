# ADR 004 — Idempotency keys on money-moving endpoints

**Status:** Accepted · **Date:** 2026-07-20

## Context

Mobile clients retry aggressively on flaky networks — exactly the conditions in
the markets Patron targets. A retried `POST /checkout/orders` or
`POST /payments` without protection charges the customer twice.

## Decision

`POST /checkout/orders` and `POST /payments` require an `Idempotency-Key`
header. `IdempotencyInterceptor` claims the key (the primary key makes the claim
atomic), stores the response on success, and replays it verbatim on retry.

A key reused with a *different* request body is rejected with 409 — that is a
client bug, not a retry, and silently treating it as one would hide it.

## Consequences

- Retries are free and safe; the client sees the original response.
- Records expire after 24 hours and are purged nightly.
- A crashed request leaves a lock that goes stale after 60 seconds, so a
  legitimate retry is not blocked forever.
- This is defence in depth, not the only guard: quote consumption and payment
  capture are independently protected by conditional updates.
