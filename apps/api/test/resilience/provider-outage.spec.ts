import nock from 'nock';
import { ProviderEngine } from '../../src/modules/providers/provider-engine.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service';
import { FazerCardsAdapter } from '../../src/modules/providers/adapters/fazercards.adapter';
import { FoxReloadAdapter } from '../../src/modules/providers/adapters/foxreload.adapter';
import { noopMetrics, noopTracing, seedOrderItem } from './helpers';

const PRIMARY = 'https://primary.test';
const SECONDARY = 'https://secondary.test';

/**
 * Provider outage simulations.
 *
 * The property under test throughout: an outage must degrade delivery, never
 * duplicate a purchase and never lose an order.
 */
describe('Provider outage', () => {
  let prisma: PrismaService;
  let engine: ProviderEngine;
  let registry: ProviderRegistry;
  let ids: Awaited<ReturnType<typeof seedOrderItem>>;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    const crypto = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);
    registry = new ProviderRegistry(
      { get: (t: any) => (t === FazerCardsAdapter ? new FazerCardsAdapter() : new FoxReloadAdapter()) } as any,
      prisma,
      crypto,
    );
    registry.onModuleInit();
    engine = new ProviderEngine(prisma, registry, crypto, noopMetrics(), noopTracing());
  });

  afterAll(() => prisma.$disconnect());
  afterEach(() => nock.cleanAll());

  beforeEach(async () => {
    ids = await seedOrderItem(prisma, { primaryBase: PRIMARY, secondaryBase: SECONDARY });
  });

  it('survives a total primary outage by failing over', async () => {
    nock(PRIMARY).post('/orders').times(1).replyWithError({ code: 'ECONNREFUSED' });
    nock(SECONDARY).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 1, pin: 'PIN' });

    const result = await engine.fulfilItem(ids.orderItemId);
    expect(result.status).toBe('DELIVERED');
  });

  it('fails the item cleanly when every provider is down', async () => {
    nock(PRIMARY).post('/orders').replyWithError({ code: 'ECONNREFUSED' });
    nock(SECONDARY).post('/transactions').replyWithError({ code: 'ECONNREFUSED' });

    const result = await engine.fulfilItem(ids.orderItemId);
    expect(result.status).toBe('FAILED');

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } });
    expect(item.status).toBe('FAILED');
    // The order still exists and is retryable — nothing was lost.
    expect(item.lastError).toBeTruthy();
  });

  it('marks the provider unhealthy so later orders skip it entirely', async () => {
    nock(PRIMARY).post('/orders').reply(503, {});
    nock(SECONDARY).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 1, pin: 'P' });

    await engine.fulfilItem(ids.orderItemId);

    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: ids.primaryId } });
    expect(provider.isHealthy).toBe(false);
  });

  it('does not double-purchase when the primary times out but actually succeeded', async () => {
    // The nastiest real-world case: the provider processed the order, the
    // response never arrived. Our idempotency key is what saves us.
    nock(PRIMARY).post('/orders').delay(1500).reply(200, { order_id: 'ext-1', status: 'completed', codes: ['C'] });
    nock(SECONDARY).post('/transactions').reply(200, { txn_id: 'tx1', status_code: 1, pin: 'P' });

    await engine.fulfilItem(ids.orderItemId);

    const calls = await prisma.providerCall.findMany({ where: { orderItemId: ids.orderItemId } });
    const keys = calls.map((c) => c.idempotencyKey);
    // One key per provider, and never two different keys to the same provider
    // for the same attempt.
    expect(new Set(keys).size).toBe(keys.length);

    const results = await prisma.orderResult.findMany({ where: { orderItemId: ids.orderItemId } });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('records every attempt even when all of them fail', async () => {
    nock(PRIMARY).post('/orders').reply(500, {});
    nock(SECONDARY).post('/transactions').reply(500, {});

    await engine.fulfilItem(ids.orderItemId);

    const calls = await prisma.providerCall.count({ where: { orderItemId: ids.orderItemId } });
    expect(calls).toBe(2);
  });

  it('recovers on operator retry once the provider is back', async () => {
    nock(PRIMARY).post('/orders').reply(500, {});
    nock(SECONDARY).post('/transactions').reply(500, {});
    await engine.fulfilItem(ids.orderItemId);

    nock.cleanAll();
    nock(PRIMARY).post('/orders').reply(200, { order_id: 'ext-2', status: 'completed', codes: ['C2'] });

    const retry = await engine.fulfilItem(ids.orderItemId);
    expect(retry.status).toBe('DELIVERED');
  });

  it('does not redeliver an item that already succeeded', async () => {
    nock(PRIMARY).post('/orders').reply(200, { order_id: 'ext-1', status: 'completed', codes: ['C'] });
    await engine.fulfilItem(ids.orderItemId);

    // A duplicate job for an already-delivered item must be a no-op.
    const second = await engine.fulfilItem(ids.orderItemId);
    expect(second.status).toBe('PROCESSING'); // claim rejected

    const results = await prisma.orderResult.count({ where: { orderItemId: ids.orderItemId } });
    expect(results).toBe(1);
  });
});
