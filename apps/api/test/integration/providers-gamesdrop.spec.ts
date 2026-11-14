import { randomUUID } from 'crypto';
import nock from 'nock';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { ProviderEngine } from '../../src/modules/providers/provider-engine.service';
import { ProviderSetupService } from '../../src/modules/providers/provider-setup.service';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service';
import { GamesDropAdapter } from '../../src/modules/providers/adapters/gamesdrop.adapter';

const BASE = 'https://partner.gamesdrop.io';

/**
 * GamesDrop on a real Postgres: connecting stores the token encrypted, a
 * linked product stays on manual delivery until the owner switches it on, and
 * the daily cap is computed from what was actually delivered today.
 */
describe('GamesDrop supplier setup (Postgres)', () => {
  let prisma: PrismaService;
  let crypto: CryptoService;
  let registry: ProviderRegistry;
  let engine: ProviderEngine;
  let setup: ProviderSetupService;
  let ownerId: string;
  let productId: string;
  const token = `shop-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    crypto = new CryptoService({ getOrThrow: () => process.env.ENCRYPTION_KEY } as never);
    const adapter = new GamesDropAdapter();
    registry = new ProviderRegistry({ get: () => adapter } as never, prisma, crypto);
    registry.onModuleInit();
    const noop = { inc: () => undefined, startTimer: () => () => undefined };
    engine = new ProviderEngine(
      prisma, registry, crypto,
      { providerCalls: noop, providerDuration: noop, providerFailovers: noop, fulfilmentAttempts: noop } as never,
      { withSpan: (_n: string, _a: unknown, fn: (s: unknown) => unknown) => fn({ setAttribute: () => undefined }) } as never,
    );
    setup = new ProviderSetupService(prisma, registry, crypto, engine);
  });

  afterAll(() => prisma.$disconnect());
  afterEach(() => nock.cleanAll());

  beforeEach(async () => {
    for (const [code, nameEn, isBase] of [['USD', 'US Dollar', true], ['MRU', 'Ouguiya', false]] as const) {
      await prisma.currency.upsert({ where: { code }, update: {}, create: { code, nameAr: code, nameEn, symbol: code, isBase } });
    }
    ownerId = (await prisma.user.create({ data: { email: `owner-${randomUUID()}@test.local`, fullName: 'Owner', passwordHash: 'x' } })).id;
    const cat = await prisma.category.create({ data: { slug: `games-${randomUUID().slice(0, 8)}`, nameAr: 'ألعاب', nameEn: 'Games' } });
    productId = (await prisma.product.create({
      data: {
        sku: `PUBG-60-${randomUUID().slice(0, 6)}`, type: 'GAME_TOPUP', delivery: 'MANUAL', nameAr: 'ببجي 60', nameEn: 'PUBG 60',
        costPrice: 0.99, sellPrice: 1.5, currency: 'USD', categoryId: cat.id,
      },
    })).id;
  });

  async function connect() {
    nock(BASE).get('/api/v1/offers/balance').reply(200, { balance: 40, currency: { code: 'USD' } });
    return setup.connect({ code: 'gamesdrop', apiKey: token, countryCode: 'MR', dailyLimit: 10 }, ownerId);
  }

  it('connect keeps the token encrypted at rest and out of every answer', async () => {
    const status = await connect();
    expect(status).toMatchObject({ code: 'gamesdrop', connected: true, balance: { balance: 40, currency: 'USD' }, dailyLimit: 10 });
    expect(JSON.stringify(status)).not.toContain(token);
    const row = await prisma.provider.findUniqueOrThrow({ where: { code: 'gamesdrop' } });
    expect(row.apiKeyEnc).not.toContain(token);
    expect(crypto.decrypt(row.apiKeyEnc)).toBe(token);
    expect(await prisma.auditLog.count({ where: { action: 'providers.connect', userId: ownerId } })).toBe(1);
  });

  it('a linked product stays manual until auto delivery is switched on, and goes back when off', async () => {
    const { id: providerId } = await connect();
    const link = await setup.link(providerId, { productId, providerSku: '101', providerCost: 0.99 }, ownerId);
    expect(link).toMatchObject({ autoDelivery: false, margin: 0.51 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).delivery).toBe('MANUAL');
    expect(await registry.candidatesFor(productId)).toHaveLength(0); // nothing would be bought

    await setup.setAuto(link!.id, true, ownerId);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).delivery).toBe('AUTO_PROVIDER');
    expect(await registry.candidatesFor(productId)).toHaveLength(1);

    await setup.setAuto(link!.id, false, ownerId);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).delivery).toBe('MANUAL');
  });

  it('spentToday counts the price paid on each purchase today, not the cost set later', async () => {
    const { id: providerId } = await connect();
    await setup.link(providerId, { productId, providerSku: '101', providerCost: 2.5 }, ownerId);
    const call = (over: Record<string, unknown>) => prisma.providerCall.create({
      data: {
        providerId, endpoint: 'fulfil', idempotencyKey: randomUUID(), success: true,
        requestBody: { sku: '101', quantity: 2, maxUnitCost: 2.5 }, responseBody: { order_id: '1', unitPrice: 2.4 }, ...over,
      },
    });
    await call({}); // GamesDrop charged 2.4 × 2 = 4.8
    await call({ responseBody: { order_id: '2' }, requestBody: { sku: '101', quantity: 1, maxUnitCost: 2.5 } }); // no price: the agreed 2.5
    await call({ success: false }); // a refused purchase costs nothing
    await call({ createdAt: new Date(Date.now() - 2 * 86_400_000) }); // not today
    expect(await engine.spentToday(providerId)).toBeCloseTo(7.3, 6);

    // the owner lowering the product's cost afterwards does not rewrite today's spend
    await setup.link(providerId, { productId, providerSku: '101', providerCost: 0.5 }, ownerId);
    expect(await engine.spentToday(providerId)).toBeCloseTo(7.3, 6);
  });

  it('the same supplier offer cannot be linked to two products', async () => {
    const { id: providerId } = await connect();
    await setup.link(providerId, { productId, providerSku: '101', providerCost: 1 }, ownerId);
    const other = await prisma.product.create({
      data: {
        sku: `PUBG-X-${randomUUID().slice(0, 6)}`, type: 'GAME_TOPUP', delivery: 'MANUAL', nameAr: 'آخر', nameEn: 'Other',
        costPrice: 1, sellPrice: 2, currency: 'USD', categoryId: (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).categoryId,
      },
    });
    await expect(setup.link(providerId, { productId: other.id, providerSku: '101', providerCost: 1 }, ownerId))
      .rejects.toMatchObject({ response: { error: 'OFFER_ALREADY_LINKED' } });
  });
});
