# ADR 002 — Provider Engine: strategy + registry

**Status:** Accepted · **Date:** 2026-07-20

## Context

FazerCards and FoxReload differ in authentication (bearer token vs signed
payload), status encoding (string enum vs numeric code), and delivery shape
(array of codes vs pin/serial pair). A third provider will differ again.

Branching on provider inside the fulfilment path would put that variance in the
one place that must stay correct: the code that spends money.

## Decision

Every provider implements `ProviderAdapter` (fulfil, checkStatus, getBalance,
healthCheck, optional webhook verify/parse). `ProviderRegistry` maps a provider
row to its adapter and decrypts credentials on demand. `ProviderEngine` resolves
candidates from `product_providers` ordered by priority and walks them until one
delivers.

The engine contains no provider names. Adding a provider is one class plus a
database row.

## Consequences

- Failover is data-driven: reorder `priority`, no deploy.
- A non-retryable failure (bad player ID, discontinued product) stops the walk
  immediately — trying the next provider would fail identically and risks
  double-spending on a partially-succeeded call.
- Each attempt carries a deterministic idempotency key derived from
  `(itemId, providerId, attemptCount)`, so a timeout followed by a retry returns
  the provider's original order rather than buying twice.
- Every attempt is written to `provider_calls` before the result is applied.
  Provider billing disputes are unwinnable without this.
- Adapter response shapes are written against integration specs and must be
  verified against each sandbox before go-live. Only the adapter file changes.
