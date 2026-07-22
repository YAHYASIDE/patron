import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import nock from 'nock';
import { randomUUID } from 'crypto';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { ProviderEngine } from '../../src/modules/providers/provider-engine.service';

/**
 * Full path: register → quote → order → pay → fulfil → reveal.
 *
 * The provider is stubbed at the HTTP boundary rather than mocked in the
 * container, so adapter serialisation, timeouts and error mapping are exercised
 * exactly as they would be in production.
 */
describe('Checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let engine: ProviderEngine;

  let token: string;
  let productId: string;
  let quoteId: string;
  let orderId: string;

  const PROVIDER_BASE = 'https://api.fazercards.test';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    engine = app.get(ProviderEngine);

    await seed(prisma, PROVIDER_BASE).then((ids) => { productId = ids.productId; });
  });

  afterAll(async () => {
    nock.cleanAll();
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('registers a customer and issues a token', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: `e2e-${Date.now()}@test.local`, password: 'CorrectHorse1', fullName: 'E2E Buyer' })
      .expect(201);

    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
    token = res.body.accessToken;
  });

  it('rejects an unauthenticated quote request', () =>
    http().post('/checkout/quotes').send({ items: [{ productId, quantity: 1 }] }).expect(401));

  it('creates a quote that is binding for 15 minutes', async () => {
    const res = await http()
      .post('/checkout/quotes')
      .set('authorization', `Bearer ${token}`)
      .send({ items: [{ productId, quantity: 1 }], currency: 'USD' })
      .expect(201);

    expect(res.body.secondsRemaining).toBeLessThanOrEqual(900);
    expect(res.body.secondsRemaining).toBeGreaterThan(880);
    expect(res.body.total).toBe('10');
    quoteId = res.body.id;
  });

  it('holds the quoted price even after the catalog price changes', async () => {
    await prisma.product.update({ where: { id: productId }, data: { sellPrice: 99 } });

    const res = await http()
      .get(`/checkout/quotes/${quoteId}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.total).toBe('10');
    await prisma.product.update({ where: { id: productId }, data: { sellPrice: 10 } });
  });

  it('requires an Idempotency-Key to create an order', () =>
    http()
      .post('/checkout/orders')
      .set('authorization', `Bearer ${token}`)
      .send({ quoteId })
      .expect(400));

  it('creates the order', async () => {
    const res = await http()
      .post('/checkout/orders')
      .set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ quoteId })
      .expect(201);

    expect(res.body.status).toBe('PENDING_PAYMENT');
    orderId = res.body.id;
  });

  it('returns the same order for a replayed Idempotency-Key', async () => {
    const key = randomUUID();
    const quote = await createQuote(http(), token, productId);

    const first = await http().post('/checkout/orders')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .send({ quoteId: quote }).expect(201);

    const replay = await http().post('/checkout/orders')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .send({ quoteId: quote }).expect(201);

    expect(replay.body.id).toBe(first.body.id);
    expect(await prisma.order.count({ where: { quoteId: quote } })).toBe(1);
  });

  it('rejects a key reused with a different body', async () => {
    const key = randomUUID();
    const a = await createQuote(http(), token, productId);
    const b = await createQuote(http(), token, productId);

    await http().post('/checkout/orders')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .send({ quoteId: a }).expect(201);

    await http().post('/checkout/orders')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', key)
      .send({ quoteId: b }).expect(409);
  });

  it('pays from the wallet and moves the order to PAID', async () => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await prisma.wallet.upsert({
      where: { userId_currencyCode: { userId: order.userId, currencyCode: 'USD' } },
      update: { balance: 100 },
      create: { userId: order.userId, currencyCode: 'USD', balance: 100 },
    });

    await http().post('/payments')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID())
      .send({ orderId, gateway: 'WALLET' })
      .expect(201);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(updated.status).toBe('PAID');
  });

  it('refuses a second payment for an order already paid', () =>
    http().post('/payments')
      .set('authorization', `Bearer ${token}`).set('Idempotency-Key', randomUUID())
      .send({ orderId, gateway: 'WALLET' })
      .expect(400));

  it('fulfils via the provider and marks the item DELIVERED', async () => {
    nock(PROVIDER_BASE).post('/orders')
      .reply(200, { order_id: 'ext-1', status: 'completed', codes: ['GIFT-CODE-1'] });

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    await engine.fulfilItem(item.id);

    const updated = await prisma.orderItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.status).toBe('DELIVERED');
    expect(updated.deliveredAt).not.toBeNull();
  });

  it('does not expose the code in the order payload', async () => {
    const res = await http().get(`/orders/${orderId}`).set('authorization', `Bearer ${token}`).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('GIFT-CODE-1');
    expect(res.body.items[0].results[0].revealed).toBe(false);
  });

  it('reveals the code through the audited endpoint', async () => {
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });

    const res = await http().post(`/orders/items/${item.id}/reveal`)
      .set('authorization', `Bearer ${token}`).expect(200);

    expect(res.body[0].value).toBe('GIFT-CODE-1');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'orders.reveal_result', entityId: item.id },
    });
    expect(audit).not.toBeNull();
  });

  it('refuses to reveal another customer’s code', async () => {
    const other = await http().post('/auth/register')
      .send({ email: `other-${Date.now()}@test.local`, password: 'CorrectHorse1', fullName: 'Other' })
      .expect(201);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    await http().post(`/orders/items/${item.id}/reveal`)
      .set('authorization', `Bearer ${other.body.accessToken}`)
      .expect(403);
  });

  it('denies admin reports to a customer token', () =>
    http().get('/admin/reports/dashboard').set('authorization', `Bearer ${token}`).expect(403));

  it('serves health and metrics without authentication', async () => {
    await http().get('/health/live').expect(200);
    await http().get('/metrics').expect(200);
  });

  it('echoes the correlation id back to the caller', async () => {
    const res = await http().get('/health/live').set('x-correlation-id', 'trace-me').expect(200);
    expect(res.headers['x-correlation-id']).toBe('trace-me');
  });
});

// ─────────────── helpers ───────────────

async function createQuote(agent: request.Test | any, token: string, productId: string) {
  const res = await agent.post('/checkout/quotes')
    .set('authorization', `Bearer ${token}`)
    .send({ items: [{ productId, quantity: 1 }], currency: 'USD' });
  return res.body.id;
}

async function seed(prisma: PrismaService, providerBase: string) {
  await prisma.currency.upsert({
    where: { code: 'USD' }, update: {},
    create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
  });
  for (const name of ['customer', 'super_admin']) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name, isSystem: true } });
  }

  const category = await prisma.category.create({
    data: { slug: `e2e-${Date.now()}`, nameAr: 'فئة', nameEn: 'Category' },
  });
  const product = await prisma.product.create({
    data: {
      sku: `E2E-${Date.now()}`, type: 'GIFT_CARD', delivery: 'AUTO_PROVIDER',
      nameAr: 'بطاقة', nameEn: 'Gift Card', costPrice: 8, sellPrice: 10,
      currency: 'USD', categoryId: category.id,
    },
  });
  const provider = await prisma.provider.create({
    data: {
      code: 'fazercards', name: 'FazerCards', baseUrl: providerBase,
      // Ciphertext produced with the test ENCRYPTION_KEY; the adapter only
      // needs it to be decryptable, not meaningful.
      apiKeyEnc: process.env.TEST_PROVIDER_KEY_ENC ?? 'AAAA.BBBB.CCCC',
      isActive: true, isHealthy: true,
    },
  });
  await prisma.productProvider.create({
    data: { productId: product.id, providerId: provider.id, providerSku: 'SKU_A', providerCost: 8 },
  });

  return { productId: product.id, providerId: provider.id };
}
