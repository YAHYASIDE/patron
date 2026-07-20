/**
 * OpenTelemetry bootstrap.
 *
 * MUST be imported before anything else — instrumentation works by patching
 * modules at require time, so any module loaded before this runs is invisible
 * to the tracer. Hence `import './tracing'` as the first line of main.ts and
 * worker.ts, and `--require ./dist/tracing` in the Dockerfile as a belt-and-
 * braces measure.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

const enabled = process.env.OTEL_ENABLED === 'true';

if (process.env.OTEL_DEBUG === 'true') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

/**
 * Head sampling at the ratio, but a sampled parent always wins. Without
 * ParentBased, a trace would be sampled at the API and dropped at the worker,
 * producing exactly the broken half-traces that make distributed tracing
 * useless for the fulfilment path.
 *
 * Errors are still always captured because failed spans are recorded regardless
 * of sampling by the tail sampler in the collector — see docs/OBSERVABILITY.md.
 */
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(Number(process.env.OTEL_SAMPLE_RATIO ?? 0.1)),
});

export const sdk = new NodeSDK({
  // resources@1.x exposes the Resource class; `resourceFromAttributes` is the
  // 2.x API and is not available on the pinned version.
  resource: new Resource({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'patron-api',
    [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? '0.0.0',
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV ?? 'development',
  }),
  sampler,
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT
      ? `${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`
      : 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Health and metrics scrapes would otherwise dominate the trace volume.
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (req) =>
          ['/health', '/health/live', '/health/ready', '/metrics'].includes((req.url ?? '').split('?')[0]),
      },
      // Traces every Prisma query, which is how N+1s become visible rather
      // than inferred.
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: true },
      // BullMQ's Redis commands; job spans come from bullmq-otel instead.
      '@opentelemetry/instrumentation-ioredis': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false }, // pure noise
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
    }),
  ],
});

if (enabled) {
  sdk.start();

  const shutdown = () => {
    // Flush pending spans before exit, or the last (and most interesting)
    // spans of a crashing process are lost.
    void sdk.shutdown().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
