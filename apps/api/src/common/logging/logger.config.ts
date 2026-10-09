import { Params } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { RequestContextStore } from '../context/request-context';
import { trace } from '@opentelemetry/api';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Structured JSON logs.
 *
 * Two properties matter more than format: every line carries the correlation id
 * so a single order can be followed across API and worker processes, and
 * secrets are redacted at the logger rather than at each call site — relying on
 * developers to remember is how tokens end up in log aggregators.
 */
export const loggerConfig = (isProduction: boolean): Params => ({
  pinoHttp: {
    level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

    genReqId: () => RequestContextStore.correlationId() || randomUUID(),

    // Attach context to every line, including those from queue workers.
    mixin() {
      const ctx = RequestContextStore.get();
      const span = trace.getActiveSpan()?.spanContext();
      return {
        ...(ctx ? { correlationId: ctx.correlationId, userId: ctx.userId, jobId: ctx.jobId } : {}),
        // Grafana/Tempo can link a log line straight to its trace on these.
        ...(span ? { traceId: span.traceId, spanId: span.spanId } : {}),
      };
    },

    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["idempotency-key"]',
        'req.headers["stripe-signature"]',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'req.body.code',
        'req.body.refreshToken',
        'req.body.apiKey',
        'req.body.apiSecret',
        'res.headers["set-cookie"]',
        '*.passwordHash',
        '*.apiKeyEnc',
        '*.codeEnc',
        '*.valueEnc',
        '*.twoFaSecretEnc',
      ],
      censor: '[REDACTED]',
    },

    // Health and metrics scrapes would otherwise dominate the log volume.
    autoLogging: {
      ignore: (req: IncomingMessage) =>
        ['/health', '/health/live', '/health/ready', '/metrics'].includes(
          // `url` is optional on IncomingMessage and carries the query string.
          (req.url ?? '').split('?')[0],
        ),
    },

    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    serializers: {
      // pino-http augments the request with `remoteAddress`; IncomingMessage
      // alone does not declare it, hence the intersection rather than `any`.
      req: (req: IncomingMessage & { remoteAddress?: string }) => ({
        method: req.method,
        url: req.url,
        ip: req.remoteAddress,
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
    },

    transport: isProduction ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
  },
});
