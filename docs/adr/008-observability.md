# ADR 008 — Observability: ALS context, business-first metrics

**Status:** Accepted · **Date:** 2026-07-22

## Context

An order's lifecycle spans two processes: the API takes payment, a worker
fulfils it. When a customer says "I paid and got nothing", the investigation
needs to join log lines across both, and the metrics need to have noticed before
the customer did.

## Decision

**Correlation via `AsyncLocalStorage`**, not Nest request scoping. Request
scoping forces the entire injection chain to be request-scoped — a measurable
throughput cost — and does not reach BullMQ workers at all. ALS follows the
async call stack into services, Prisma hooks and processors without touching a
single constructor.

**Metrics are business-first.** Request rate and latency are table stakes. The
metrics that actually page someone are `patron_outbox_pending` (committed orders
not reaching workers), `patron_provider_failovers_total` (the primary degrading
before customers notice) and paid-but-undelivered.

**Labels are bounded sets only.** Route *patterns*, provider codes, currencies,
statuses. Never an order id or user id — that creates one time series per
entity and eventually takes Prometheus down.

**Three health endpoints**, because Kubernetes asks three questions. Liveness
depends on nothing external: a database blip must not restart every pod and turn
a degradation into an outage.

## Consequences

- A single correlation id traces an order across API and worker.
- Redaction is configured once at the logger rather than relying on every call
  site to remember not to log a token.
- `/metrics` requires a bearer token: the metric names alone disclose order
  volume, revenue and provider relationships.
- ALS has a small per-request cost and is easy to lose across a manually
  constructed Promise. Worth it for the cross-process trace.
