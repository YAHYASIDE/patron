# ADR 019 — One error shape, correlation id always present

**Status:** Accepted · **Date:** 2026-07-23

## Context

A validation failure, a Prisma unique violation and an unhandled throw each
produced a different JSON structure. Every client needed three parsing paths,
and the third leaked the raw exception message — which routinely contains table
names, connection strings and occasionally credentials.

## Decision

A global `AllExceptionsFilter` produces one envelope for every endpoint, with
`correlationId` always present. Unhandled exceptions are logged with a stack and
returned as a generic message.

Filter registration order matters: Nest applies the *last* matching filter, so
the catch-all is registered first and the specific Prisma filter wins.

## Consequences

- Clients parse one shape.
- A customer can quote the correlation id and support opens the exact trace —
  the id is the trace id when tracing is enabled (ADR 014).
- Internal details reach the log, never the client.
- Deliberately no error *codes* enum. It would need maintaining, and the
  combination of HTTP status plus a human-readable message has been sufficient.
  Worth revisiting when a third-party API exists and clients need to branch
  programmatically.
