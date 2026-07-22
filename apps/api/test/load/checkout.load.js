/**
 * k6 load profile for the checkout path.
 *
 *   k6 run --env BASE_URL=https://staging.patron.io test/load/checkout.load.js
 *
 * Thresholds are the point of this file. A load test without a pass/fail
 * threshold is a graph nobody looks at; these are set to the latency at which
 * a customer starts to think the app is broken.
 */
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = __ENV.BASE_URL || 'http://localhost:3000/api/v1';

const quoteLatency = new Trend('quote_latency');
const orderLatency = new Trend('order_latency');
const duplicateOrders = new Counter('duplicate_orders');
const checkoutSuccess = new Rate('checkout_success');

export const options = {
  scenarios: {
    // Normal traffic: what a good day looks like.
    steady: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '5m', target: 50 },
        { duration: '1m', target: 0 },
      ],
      exec: 'checkout',
    },
    // Spike: a promotion goes live, or a streamer mentions you.
    spike: {
      executor: 'ramping-arrival-rate',
      startTime: '8m',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 500,
      stages: [
        { duration: '30s', target: 300 },
        { duration: '2m', target: 300 },
        { duration: '30s', target: 10 },
      ],
      exec: 'checkout',
    },
    // Browsing dominates real traffic; it must not be starved by checkout.
    browse: {
      executor: 'constant-vus',
      vus: 100,
      duration: '12m',
      exec: 'browse',
    },
  },
  thresholds: {
    // Beyond ~1.5s on a quote, people tap the button again.
    quote_latency: ['p(95)<1500'],
    order_latency: ['p(95)<2000'],
    checkout_success: ['rate>0.99'],
    // The non-negotiable one.
    duplicate_orders: ['count==0'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{scenario:browse}': ['p(95)<500'],
  },
};

function login() {
  const email = `load-${uuidv4()}@test.local`;
  const res = http.post(`${BASE}/auth/register`, JSON.stringify({
    email, password: 'CorrectHorse1', fullName: 'Load Test',
  }), { headers: { 'content-type': 'application/json' } });

  return res.status === 201 ? res.json('accessToken') : null;
}

export function browse() {
  group('storefront', () => {
    const res = http.get(`${BASE}/catalog/products?limit=20&currency=XOF`);
    check(res, { 'products 200': (r) => r.status === 200 });
  });
  sleep(Math.random() * 3);
}

export function checkout() {
  const token = login();
  if (!token) return;
  const auth = { headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` } };

  const products = http.get(`${BASE}/catalog/products?limit=1`);
  const productId = products.json('data.0.id');
  if (!productId) return;

  let quoteId;
  group('quote', () => {
    const res = http.post(`${BASE}/checkout/quotes`, JSON.stringify({
      items: [{ productId, quantity: 1 }], currency: 'USD',
    }), auth);
    quoteLatency.add(res.timings.duration);
    check(res, { 'quote created': (r) => r.status === 201 });
    quoteId = res.json('id');
  });
  if (!quoteId) { checkoutSuccess.add(false); return; }

  group('order', () => {
    // Deliberately submit twice with the same key — this is what a flaky
    // mobile connection does, and the platform must produce one order.
    const key = uuidv4();
    const headers = { ...auth.headers, 'idempotency-key': key };
    const body = JSON.stringify({ quoteId });

    const first = http.post(`${BASE}/checkout/orders`, body, { headers });
    const retry = http.post(`${BASE}/checkout/orders`, body, { headers });

    orderLatency.add(first.timings.duration);
    const ok = first.status === 201;
    checkoutSuccess.add(ok);
    check(first, { 'order created': () => ok });

    if (ok && retry.status === 201 && retry.json('id') !== first.json('id')) {
      duplicateOrders.add(1);
    }
  });

  sleep(1);
}
