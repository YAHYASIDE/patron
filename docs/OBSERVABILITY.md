# Observability

## Logs

Structured JSON via pino. Every line carries `correlationId`, and `userId` /
`jobId` where known, so a single order can be followed across the API and worker
processes.

Correlation ids are honoured from an inbound `x-correlation-id` header and
echoed back in the response, so a trace started at the mobile client stays
intact.

Secrets are redacted at the logger, not at call sites — see
`common/logging/logger.config.ts` for the path list.

```
LOG_LEVEL=info    # debug in development
```

## Metrics

Prometheus exposition at `GET /metrics`, guarded by `METRICS_TOKEN`.

### Scrape config

```yaml
scrape_configs:
  - job_name: patron-api
    scrape_interval: 15s
    metrics_path: /metrics
    authorization:
      credentials: ${METRICS_TOKEN}
    static_configs:
      - targets: ['patron-api:3000']

  - job_name: patron-worker
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ['patron-worker:3001']
```

### The metrics that matter

Business first — request rate is table stakes, but what pages someone at 3am is
"orders are being paid for and not delivered".

| Metric | Why |
|---|---|
| `patron_orders_completed_total{status}` | The outcome distribution, not just volume |
| `patron_order_value_base_total` | Revenue rate, comparable across currencies |
| `patron_provider_calls_total{provider,result}` | Per-provider success rate |
| `patron_provider_failovers_total` | Primary degrading *before* customers notice |
| `patron_provider_healthy{provider}` | Gate on the failover list |
| `patron_provider_balance{provider}` | Running out of provider credit stops sales |
| `patron_fulfilment_duration_seconds` | Payment captured → delivered |
| `patron_queue_depth{queue,state}` | Backlog per failure domain |
| `patron_worker_heartbeat_timestamp` | Distinguishes dead worker from slow worker |
| `patron_outbox_pending` / `_dead` | A stalled outbox = silently unfulfilled orders |
| `patron_wallet_drift_count` | Should always be 0; non-zero is a bug |
| `patron_fx_rate_age_seconds{currency}` | Stale rates on a 604:1 pair get expensive |
| `patron_refresh_token_reuse_total` | Possible token theft |

## Alerting

```yaml
groups:
  - name: patron-critical
    rules:
      - alert: PaidOrdersNotFulfilling
        expr: |
          increase(patron_orders_completed_total{status="FAILED"}[10m]) > 5
        for: 5m
        annotations:
          summary: "Orders are failing fulfilment"

      - alert: OutboxStalled
        expr: patron_outbox_pending > 100
        for: 5m
        annotations:
          summary: "Outbox backlog — committed orders are not reaching workers"

      - alert: OutboxDead
        expr: patron_outbox_dead > 0
        for: 1m
        annotations:
          summary: "Outbox events parked as DEAD — manual intervention required"

      - alert: WalletDrift
        expr: patron_wallet_drift_count > 0
        annotations:
          summary: "A wallet balance disagrees with its ledger — a write bypassed post()"

      - alert: AllProvidersUnhealthy
        expr: sum(patron_provider_healthy) == 0
        for: 2m
        annotations:
          summary: "No healthy providers — fulfilment has stopped"

      - alert: WorkerDead
        expr: |
          time() - patron_worker_heartbeat_timestamp > 120
          and patron_queue_depth{state="waiting"} > 0
        for: 2m
        annotations:
          summary: "Worker heartbeat stale while jobs are waiting"

      - alert: FxRatesStale
        expr: patron_fx_rate_age_seconds > 21600
        for: 10m
        annotations:
          summary: "FX rates older than 6 hours"

      - alert: ProviderDegraded
        expr: |
          rate(patron_provider_failovers_total[15m]) > 0.1
        for: 10m
        annotations:
          summary: "Frequent failover — the primary provider is degraded"
```

The heartbeat alert deliberately requires *both* a stale heartbeat and waiting
jobs: a quiet queue with no heartbeat at 4am is a worker with nothing to do, not
an incident.

## Grafana dashboards

Four dashboards, split by who is looking and what question they are asking.

### 1. Business overview — for whoever owns the P&L

- Revenue rate: `rate(patron_order_value_base_total[1h]) * 3600`
- Orders by outcome: `sum by (status) (increase(patron_orders_completed_total[1h]))`
- Quote→order conversion:
  `increase(patron_orders_created_total[1h]) / increase(patron_quotes_created_total[1h])`
- Revenue split by currency (stacked)
- Payment success rate by gateway

### 2. Fulfilment health — the on-call default

- **Top row, largest panel:** paid-but-undelivered count. Everything else is
  secondary to this.
- Fulfilment latency p50/p95/p99: `histogram_quantile(0.95, rate(patron_fulfilment_duration_seconds_bucket[5m]))`
- Provider success rate by provider
- Failover rate — the leading indicator of provider trouble
- Provider latency p95 per provider
- Provider balance gauges with threshold colouring

### 3. Queues and workers

- Queue depth by state, stacked per queue
- Job throughput and failure rate per job type
- Retry rate: `rate(patron_job_retries_total[5m])`
- Worker heartbeat age: `time() - patron_worker_heartbeat_timestamp`
- Outbox pending and dead, on the same axis

### 4. API and reliability

- Request rate, error rate, duration p50/p95/p99 by route
- Auth failure rate; refresh token reuse (should be flat at zero)
- Idempotency replay rate — a rising rate means clients are retrying, which
  usually means something upstream is slow
- Wallet drift (should be flat at zero)
- FX rate age per currency

### Panel conventions

Set the fulfilment latency panel's threshold to the customer's actual
expectation, not a round number. For a digital top-up that is roughly 30
seconds — beyond that, people start opening support tickets, and the dashboard
should turn amber before the tickets arrive.
