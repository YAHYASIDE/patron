# ADR 015 — Deployment topology

**Status:** Accepted · **Date:** 2026-07-23

## Decisions

**Separate API and worker deployments** from one image. A worker mid-provider
call has already spent money and needs a 90-second grace period; an API pod
needs 45. Sharing a deployment would force the worse of both.

**Migrations as a pre-deploy Job, not an initContainer.** An initContainer runs
once per pod, so three replicas racing `migrate deploy` is three concurrent
advisory-lock waits on every deploy.

**`maxUnavailable: 0`.** Never reduce capacity during a rollout.

**Workers autoscale on queue depth, not CPU.** A worker blocked on a slow
provider call uses no CPU while the backlog grows. CPU-based scaling would
never fire in exactly the situation where scaling is needed.

**Liveness must not touch the database.** A database blip would otherwise
restart every pod simultaneously, turning a degradation into an outage.
Readiness checks dependencies; liveness checks only that the process is alive.

**`readOnlyRootFilesystem`, non-root, all capabilities dropped, default-deny
NetworkPolicy.** The blast radius of a compromised container is a design
parameter, not an afterthought.

**Webhook routes disable request buffering** at both nginx and the ingress.
Signature verification runs against the raw bytes; a re-serialised body fails a
signature it should pass.

## Consequences

- Rollback is `kubectl rollout undo`. **Migrations do not roll back**, so every
  migration must be backward-compatible with the previous app version —
  expand/contract across two releases, never rename in one.
- The deploy pipeline takes a verified backup *before* migrating. A migration
  without a restore point is a decision to accept data loss.
- Post-deploy verification fails the deploy if `patron_outbox_pending` exceeds
  100 — that means committed orders are not reaching workers on the new version,
  which is worse than a failed deploy.
