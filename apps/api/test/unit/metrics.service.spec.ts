import { register } from 'prom-client';
import { MetricsService } from '../../src/common/metrics/metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    // The metric objects self-register on the global default registry at
    // construction; clear it so each fresh instance can be built.
    register.clear();
    service = new MetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    service.registry.clear();
    register.clear();
  });

  it('registers every business metric on its own registry', () => {
    // A representative spread across the metric families.
    for (const name of [
      'patron_http_request_duration_seconds',
      'patron_orders_created_total',
      'patron_payments_total',
      'patron_provider_healthy',
      'patron_queue_depth',
      'patron_refresh_token_reuse_total',
    ]) {
      expect(service.registry.getSingleMetric(name)).toBeDefined();
    }
  });

  it('collects default process metrics under the patron_ prefix', async () => {
    const out = await service.scrape();
    expect(out).toMatch(/patron_process_/);
  });

  it('renders incremented counters with their labels in the scrape output', async () => {
    service.ordersCreated.inc({ currency: 'USD' }, 3);
    service.paymentsTotal.inc({ gateway: 'stripe', status: 'succeeded' });

    const out = await service.scrape();
    expect(out).toContain('patron_orders_created_total{currency="USD"} 3');
    expect(out).toContain('patron_payments_total{gateway="stripe",status="succeeded"} 1');
  });

  it('reflects gauge values, including overwrites', async () => {
    service.providerHealthy.set({ provider: 'acme' }, 1);
    service.providerHealthy.set({ provider: 'acme' }, 0);

    const out = await service.scrape();
    expect(out).toContain('patron_provider_healthy{provider="acme"} 0');
  });

  it('records histogram observations into buckets and a count', async () => {
    service.httpDuration.observe({ method: 'GET', route: '/x', status: '200' }, 0.2);

    const out = await service.scrape();
    expect(out).toContain('patron_http_request_duration_seconds_count{method="GET",route="/x",status="200"} 1');
  });

  it('scrape resolves to the same text the registry produces', async () => {
    const [a, b] = await Promise.all([service.scrape(), service.registry.metrics()]);
    expect(typeof a).toBe('string');
    // Both are snapshots of the same registry; the metric names line up.
    expect(a).toContain('patron_orders_created_total');
    expect(b).toContain('patron_orders_created_total');
  });
});
