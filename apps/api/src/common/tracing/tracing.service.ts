import { Injectable } from '@nestjs/common';
import { Span, SpanStatusCode, trace, context, propagation } from '@opentelemetry/api';
import { RequestContextStore } from '../context/request-context';

export const TRACER_NAME = 'patron';

/**
 * Thin wrapper over the OTel API.
 *
 * Auto-instrumentation covers HTTP, Postgres and Redis. What it cannot know is
 * the *business* boundary — "fulfil this order item via this provider" is one
 * span that spans several HTTP calls and database writes, and that is the span
 * an engineer actually wants when an order is stuck.
 */
@Injectable()
export class TracingService {
  private readonly tracer = trace.getTracer(TRACER_NAME);

  /**
   * Run `fn` inside a span, recording exceptions and setting error status.
   * Attributes must be low cardinality for the same reason metric labels are:
   * an order id is fine on a span (spans are individually addressable), but
   * never promote one to a metric label.
   */
  async withSpan<T>(
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    return this.tracer.startActiveSpan(name, { attributes }, async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  /** Current trace id, for stamping onto logs and error responses. */
  traceId(): string | undefined {
    return trace.getActiveSpan()?.spanContext().traceId;
  }

  spanId(): string | undefined {
    return trace.getActiveSpan()?.spanContext().spanId;
  }

  /**
   * Serialise the active trace context into a carrier (W3C `traceparent`).
   * Used to push context into job payloads and outbound provider requests so a
   * trace survives the process boundary.
   */
  inject(carrier: Record<string, string> = {}): Record<string, string> {
    propagation.inject(context.active(), carrier);
    return carrier;
  }

  /** Resume a trace from a carrier — the mirror of `inject`. */
  async withRemoteContext<T>(carrier: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const parent = propagation.extract(context.active(), carrier);
    return context.with(parent, fn);
  }

  /** Keep the log correlation id and the trace id joined up. */
  syncCorrelationId() {
    const traceId = this.traceId();
    if (traceId) RequestContextStore.set({ correlationId: traceId });
  }
}
