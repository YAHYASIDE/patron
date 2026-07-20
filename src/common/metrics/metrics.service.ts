import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics.
 *
 * Deliberately business-first: request rate is table stakes, but what actually
 * pages someone at 3am is "orders are being paid for and not delivered" or
 * "the primary provider is failing over on every call". Those are counters
 * here, not something to infer from logs.
 *
 * Label cardinality is kept low on purpose — provider code, currency and status
 * are bounded sets. Never label with an order id or a user id.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // ── HTTP ──
  readonly httpDuration = new Histogram({
    name: 'patron_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  // ── Orders ──
  readonly ordersCreated = new Counter({
    name: 'patron_orders_created_total',
    help: 'Orders created',
    labelNames: ['currency'] as const,
  });
  readonly ordersCompleted = new Counter({
    name: 'patron_orders_completed_total',
    help: 'Orders reaching a terminal state',
    labelNames: ['status', 'currency'] as const,
  });
  readonly orderValue = new Counter({
    name: 'patron_order_value_base_total',
    help: 'Gross order value in base currency',
    labelNames: ['currency'] as const,
  });
  readonly quotesCreated = new Counter({ name: 'patron_quotes_created_total', help: 'Quotes created' });
  readonly quotesExpired = new Counter({ name: 'patron_quotes_expired_total', help: 'Quotes expired unused' });

  // ── Payments ──
  readonly paymentsTotal = new Counter({
    name: 'patron_payments_total',
    help: 'Payment attempts by gateway and outcome',
    labelNames: ['gateway', 'status'] as const,
  });
  readonly paymentDuration = new Histogram({
    name: 'patron_payment_duration_seconds',
    help: 'Time to reach a terminal payment state',
    labelNames: ['gateway'] as const,
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  });
  readonly webhooksTotal = new Counter({
    name: 'patron_webhooks_total',
    help: 'Inbound webhooks by source and result',
    labelNames: ['source', 'result'] as const,
  });

  // ── Providers ──
  readonly providerCalls = new Counter({
    name: 'patron_provider_calls_total',
    help: 'Outbound provider calls',
    labelNames: ['provider', 'operation', 'result'] as const,
  });
  readonly providerDuration = new Histogram({
    name: 'patron_provider_call_duration_seconds',
    help: 'Provider call latency',
    labelNames: ['provider', 'operation'] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30],
  });
  readonly providerFailovers = new Counter({
    name: 'patron_provider_failovers_total',
    help: 'Times fulfilment fell through to a secondary provider',
    labelNames: ['from_provider', 'to_provider'] as const,
  });
  readonly providerHealthy = new Gauge({
    name: 'patron_provider_healthy',
    help: '1 when the provider passed its last health check',
    labelNames: ['provider'] as const,
  });
  readonly providerBalance = new Gauge({
    name: 'patron_provider_balance',
    help: 'Remaining credit with the provider',
    labelNames: ['provider'] as const,
  });

  // ── Fulfilment ──
  readonly fulfilmentAttempts = new Counter({
    name: 'patron_fulfilment_attempts_total',
    help: 'Fulfilment attempts by outcome',
    labelNames: ['result'] as const,
  });
  readonly fulfilmentDuration = new Histogram({
    name: 'patron_fulfilment_duration_seconds',
    help: 'Payment captured → item delivered',
    buckets: [1, 5, 15, 30, 60, 180, 600],
  });

  // ── Queues ──
  readonly queueDepth = new Gauge({
    name: 'patron_queue_depth',
    help: 'Jobs in a queue by state',
    labelNames: ['queue', 'state'] as const,
  });
  readonly jobsProcessed = new Counter({
    name: 'patron_jobs_processed_total',
    help: 'Jobs processed',
    labelNames: ['queue', 'job', 'result'] as const,
  });
  readonly jobDuration = new Histogram({
    name: 'patron_job_duration_seconds',
    help: 'Job execution time',
    labelNames: ['queue', 'job'] as const,
    buckets: [0.1, 0.5, 1, 5, 15, 30, 60, 300],
  });
  readonly jobRetries = new Counter({
    name: 'patron_job_retries_total',
    help: 'Job retry attempts',
    labelNames: ['queue', 'job'] as const,
  });
  readonly workerHeartbeat = new Gauge({
    name: 'patron_worker_heartbeat_timestamp',
    help: 'Unix timestamp of the last worker heartbeat',
    labelNames: ['queue'] as const,
  });

  // ── Reliability ──
  readonly outboxPending = new Gauge({ name: 'patron_outbox_pending', help: 'Unpublished outbox events' });
  readonly outboxDead = new Gauge({ name: 'patron_outbox_dead', help: 'Outbox events parked as DEAD' });
  readonly idempotencyReplays = new Counter({
    name: 'patron_idempotency_replays_total',
    help: 'Requests served from a stored idempotent response',
    labelNames: ['endpoint'] as const,
  });
  readonly walletDrift = new Gauge({
    name: 'patron_wallet_drift_count',
    help: 'Wallets whose cached balance disagrees with the ledger',
  });
  readonly fxRateAge = new Gauge({
    name: 'patron_fx_rate_age_seconds',
    help: 'Age of the newest active FX rate',
    labelNames: ['currency'] as const,
  });

  // ── Auth ──
  readonly authAttempts = new Counter({
    name: 'patron_auth_attempts_total',
    help: 'Authentication attempts',
    labelNames: ['result'] as const,
  });
  readonly tokenReuseDetected = new Counter({
    name: 'patron_refresh_token_reuse_total',
    help: 'Refresh token reuse detections (possible token theft)',
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: 'patron_' });
    for (const metric of [
      this.httpDuration, this.ordersCreated, this.ordersCompleted, this.orderValue,
      this.quotesCreated, this.quotesExpired, this.paymentsTotal, this.paymentDuration,
      this.webhooksTotal, this.providerCalls, this.providerDuration, this.providerFailovers,
      this.providerHealthy, this.providerBalance, this.fulfilmentAttempts, this.fulfilmentDuration,
      this.queueDepth, this.jobsProcessed, this.jobDuration, this.jobRetries, this.workerHeartbeat,
      this.outboxPending, this.outboxDead, this.idempotencyReplays, this.walletDrift,
      this.fxRateAge, this.authAttempts, this.tokenReuseDetected,
    ]) {
      this.registry.registerMetric(metric as any);
    }
  }

  scrape() {
    return this.registry.metrics();
  }
}
