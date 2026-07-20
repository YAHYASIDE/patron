# ADR 018 — Removing complexity that was not earning its keep

**Status:** Accepted · **Date:** 2026-07-24

## Context

A Staff-level pass over the codebase, looking specifically for things that add
flexibility nobody uses. Unused abstraction is worse than none: it has to be
read, understood and maintained, and it misleads about how the system works.

## Removed

**`PrismaService.visible` soft-delete extension.** Every call site passed
`deletedAt: null` explicitly anyway, so the extension was dead code that
*looked* live. Worse, an extension that silently rewrites query semantics is a
footgun — the day someone needs to read a deleted row for an audit, it is the
last place they look. Explicit filters are longer and better.

**`PrismaService.softDelete()` helper.** Dynamic delegate lookup by string, used
nowhere, defeating type safety for no benefit.

## Consolidated

**Audit writing.** `prisma.auditLog.create` appeared in eight services, each
spelling it slightly differently — some captured the IP, some did not, some
forgot the actor. `AuditService` makes the shape uniform, attaches request
context automatically, and **redacts sensitive fields**: audit rows are often
before/after snapshots of whole records, which is exactly how a password hash
ends up readable to anyone with report access.

**Error responses.** A single `AllExceptionsFilter` gives every failure the same
envelope, including the correlation and trace id. When a customer reports a
problem, that string is the whole investigation instead of "sometime this
afternoon".

## Kept deliberately, with reasons

**Order and quote numbering remain separate functions.** Extracting a two-line
helper would couple two modules for no benefit, and the formats are likely to
diverge — invoice numbering will need sequence guarantees quote numbers do not.

**`PaginationDto` survives alongside `CursorDto`.** Admin catalog screens
genuinely want page numbers over small, bounded tables. Forcing cursors
everywhere would be consistency for its own sake.

**Three separate report services** (`ReportsService`, `AnalyticsService`,
`RollupService`). They answer different questions — what happened, is it getting
better, and the pre-aggregated cache. Merging them would produce one file nobody
wants to open.

## Consequences

- Roughly 120 lines removed, and one fewer way for query semantics to surprise
  someone.
- Audit entries are uniform and safe by construction rather than by discipline.
- The "kept deliberately" list exists so the next reviewer does not re-raise
  these and spend a day re-deriving the same conclusions.
