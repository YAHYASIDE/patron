import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { trace } from '@opentelemetry/api';
import { RequestContextStore } from './request-context';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Establishes the request context for everything downstream. An inbound
 * correlation id is honoured so a trace started at the mobile client or an
 * upstream gateway stays intact across service boundaries.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const inbound = req.headers[CORRELATION_HEADER];
    const header = Array.isArray(inbound) ? inbound[0] : inbound;

    /**
     * Prefer the trace id. Logs and traces then share one identifier, so
     * jumping from a log line to its trace is a copy-paste rather than a
     * correlation exercise. Falls back to an inbound header, then a UUID.
     */
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    const correlationId = traceId ?? header ?? randomUUID();

    res.setHeader(CORRELATION_HEADER, correlationId);

    RequestContextStore.run(
      { correlationId, ip: req.ip, path: req.originalUrl },
      () => next(),
    );
  }
}
