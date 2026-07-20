# ADR 014 — Distributed tracing with OpenTelemetry

**Status:** Accepted · **Date:** 2026-07-23

## Context

An order spans two processes and several external calls. Correlation ids (ADR
008) let you *find* the related log lines; they do not tell you where the two
seconds went.

## Decision

OpenTelemetry with OTLP export, auto-instrumentation for HTTP, Postgres and
Redis, plus explicit business spans where the boundary matters.

**BullMQ uses its native telemetry interface** (`bullmq-otel`) rather than a
monkey-patching instrumentation package. BullMQ ships a first-party telemetry
hook precisely because patching libraries break on every minor release. Producer
and consumer spans are linked automatically, so a fulfilment job's span is a
child of the HTTP request that enqueued it — across processes.

**The correlation id is the trace id** when tracing is enabled. Logs and traces
then share one identifier, so jumping from a log line to its trace is a
copy-paste rather than a correlation exercise.

**Sampling is `ParentBased(TraceIdRatio(0.1))` at the app, with tail sampling in
the collector.** Head sampling alone would discard the traces you actually
want — the errors and the slow ones. The collector keeps 100% of errors,
anything over 2s, and every trace touching a provider, plus a 10% baseline.
`ParentBased` matters specifically here: without it a trace would be sampled at
the API and dropped at the worker, producing exactly the broken half-traces that
make tracing useless for the fulfilment path.

## Consequences

- The full path — request → quote → order → payment → queue → worker →
  provider HTTP call → database write — is one trace.
- Prisma spans make N+1 queries visible rather than inferred. The product
  listing N+1 was found by reading code; the next one will be found by reading a
  flame graph.
- `tracing.ts` must be imported first, before any instrumented module is
  loaded. Enforced by being line one of both entrypoints.
- Tracing is off by default (`OTEL_ENABLED=false`). Tracing that cannot be
  disabled is an availability risk in its own right.
- Span attributes carry order and item ids. Safe on spans, which are
  individually addressable — never promote them to metric labels.
