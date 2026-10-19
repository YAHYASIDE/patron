import { PrismaClient } from '@prisma/client';
import {
  applyCatalogPack,
  artUrl,
  CATALOG_PACK_HIDDEN_SKUS,
  CATALOG_PACK_KEY,
  CATALOG_PACK_SKUS,
  CATALOG_PACK_V2_KEY,
  CATALOG_PACK_V3_KEY,
  CATALOG_PACK_V4_KEY,
  CATALOG_PACK_V5_KEY,
  CATALOG_PACK_V6_KEY,
  V6_HIDE,
} from '../../src/bootstrap/catalog-pack';

type Row = Record<string, unknown> & { id: string };

/** In-memory stand-in for the tables the packs touch. */
function fakePrisma(
  seed: {
    settings?: string[];
    categories?: string[];
    games?: string[];
    products?: Array<Partial<Row> & { sku: string }>;
    currencies?: Array<{ code: string; roundingStep: number | null }>;
  } = {},
) {
  let n = 0;
  const id = () => `id-${++n}`;
  const settings = new Map((seed.settings ?? []).map((k) => [k, { key: k }]));
  const categories = new Map<string, Row>((seed.categories ?? []).map((s) => [s, { id: `cat-${s}`, slug: s }]));
  const games = new Map<string, Row>((seed.games ?? []).map((s) => [s, { id: `game-${s}`, slug: s }]));
  const products = new Map<string, Row>((seed.products ?? []).map((p) => [p.sku, { id: `prod-${p.sku}`, imageUrl: null, ...p }]));
  const currencies = new Map((seed.currencies ?? []).map((c) => [c.code, { ...c }]));
  const prices = new Map<string, { productId: string; currencyCode: string; sellPrice: number }>();

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) =>
      v !== null && typeof v === 'object' && 'in' in (v as object)
        ? ((v as { in: unknown[] }).in).includes(row[k])
        : (row[k] ?? null) === v,
    );

  const client = {
    systemSetting: {
      findUnique: jest.fn(({ where }) => Promise.resolve(settings.get(where.key) ?? null)),
      create: jest.fn(({ data }) => (settings.set(data.key, data), Promise.resolve(data))),
    },
    category: {
      findUnique: jest.fn(({ where }) => Promise.resolve(categories.get(where.slug) ?? null)),
      create: jest.fn(({ data }) => {
        const row = { ...data, id: id() };
        categories.set(data.slug, row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }) => {
        let count = 0;
        for (const row of categories.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      }),
    },
    game: {
      findUnique: jest.fn(({ where }) => Promise.resolve(games.get(where.slug) ?? null)),
      create: jest.fn(({ data }) => {
        const row = { ...data, id: id() };
        games.set(data.slug, row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }) => {
        let count = 0;
        for (const row of games.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      }),
      update: jest.fn(({ where, data }) => {
        const row = [...games.values()].find((g) => g.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
    product: {
      findUnique: jest.fn(({ where }) => Promise.resolve(products.get(where.sku) ?? null)),
      create: jest.fn(({ data }) => {
        const row = { imageUrl: null, ...data, id: id() };
        products.set(data.sku, row);
        return Promise.resolve(row);
      }),
      updateMany: jest.fn(({ where, data }) => {
        let count = 0;
        for (const row of products.values()) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return Promise.resolve({ count });
      }),
      update: jest.fn(({ where, data }) => {
        const row = [...products.values()].find((p) => p.id === where.id);
        if (row) Object.assign(row, data);
        return Promise.resolve(row);
      }),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          [...products.values()].filter((p) =>
            (where.OR as Array<{ sku: { startsWith: string } }>).some((c) => String(p.sku).startsWith(c.sku.startsWith)),
          ),
        ),
      ),
      upsert: jest.fn(),
    },
    currency: {
      findUnique: jest.fn(({ where }) => Promise.resolve(currencies.get(where.code) ?? null)),
      updateMany: jest.fn(({ where, data }) => {
        const c = currencies.get(where.code);
        if (!c || c.roundingStep !== where.roundingStep) return Promise.resolve({ count: 0 });
        Object.assign(c, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    productPrice: {
      findUnique: jest.fn(({ where }) => {
        const k = where.productId_currencyCode;
        return Promise.resolve(prices.get(`${k.productId}:${k.currencyCode}`) ?? null);
      }),
      create: jest.fn(({ data }) => (prices.set(`${data.productId}:${data.currencyCode}`, data), Promise.resolve(data))),
    },
    $disconnect: jest.fn(),
  };
  return { client, products, settings, categories, games, currencies, prices };
}

const asClient = (c: unknown) => c as PrismaClient;

describe('applyCatalogPack', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('on an empty database creates every product as MANUAL, in USD, at or above cost, with art', async () => {
    const { client, products, settings } = fakePrisma();
    await applyCatalogPack(asClient(client));

    expect(products.size).toBe(CATALOG_PACK_SKUS.length);
    for (const p of products.values()) {
      expect(p.delivery).toBe('MANUAL');
      expect(p.currency).toBe('USD');
      expect(p.sellPrice as number).toBeGreaterThanOrEqual(p.costPrice as number);
      expect(p.categoryId).toBeTruthy();
      expect(p.imageUrl).toBe(artUrl(p.sku as string));
      if (p.type === 'GAME_TOPUP') expect(p.gameId).toBeTruthy(); // the API enforces this too
    }
    expect([CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY, CATALOG_PACK_V5_KEY].every((k) => settings.has(k))).toBe(true);
  });

  it('keeps the crypto vouchers hidden, and v5 opens the crypto section for the top-ups', async () => {
    const { client, products, categories } = fakePrisma();
    await applyCatalogPack(asClient(client));

    expect(CATALOG_PACK_HIDDEN_SKUS.length).toBeGreaterThan(0);
    for (const sku of CATALOG_PACK_HIDDEN_SKUS) expect(products.get(sku)?.isActive).toBe(false);
    expect(categories.get('crypto')?.isActive).toBe(true);
  });

  it('v6 hides, once, the products that cannot be delivered as sold, and nothing else', async () => {
    const { client } = fakePrisma({ settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY, CATALOG_PACK_V5_KEY] });
    await applyCatalogPack(asClient(client));

    expect(client.product.updateMany).toHaveBeenCalledTimes(1);
    expect(client.product.updateMany).toHaveBeenCalledWith({ where: { sku: { in: V6_HIDE }, isActive: true }, data: { isActive: false } });
    expect(V6_HIDE).toEqual(expect.arrayContaining(['FF-DIAMONDS-100', 'SUB-CHATGPT-1M', 'GC-RIOT-10']));
    // hidden, never deleted or edited otherwise: the owner can show any of them again
    expect(client.product.update).not.toHaveBeenCalled();
  });

  it('does nothing once every marker exists', async () => {
    const { client } = fakePrisma({ settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY, CATALOG_PACK_V5_KEY, CATALOG_PACK_V6_KEY] });
    await applyCatalogPack(asClient(client));

    expect(client.category.create).not.toHaveBeenCalled();
    expect(client.product.create).not.toHaveBeenCalled();
    expect(client.product.updateMany).not.toHaveBeenCalled();
  });

  it('on a store that already has v1 (the live case) only adds v2, fills missing art and keeps the owner image', async () => {
    const ownImage = 'https://example.com/my-own-photo.jpg';
    const { client, products } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V5_KEY],
      categories: ['games', 'gift-cards', 'subscriptions', 'software', 'apps-topup'],
      products: [
        { sku: 'TOP-PUBG-660', imageUrl: null },
        { sku: 'GC-APPLE-US-25', imageUrl: ownImage },
        { sku: 'GC-RAZER-10', categoryId: 'cat-gift-cards' },
        { sku: 'GC-RAZER-25', categoryId: 'cat-subscriptions' }, // re-filed by the owner
      ],
    });
    await applyCatalogPack(asClient(client));

    // v1 skipped: only v3's operators and v4's Claude are new games
    expect(client.game.create.mock.calls.map(([a]) => a.data.slug)).toEqual(['mattel', 'mauritel', 'chinguitel', 'claude']);
    expect(products.get('TOP-PUBG-660')?.imageUrl).toBe(artUrl('TOP-PUBG-660'));
    expect(products.get('GC-APPLE-US-25')?.imageUrl).toBe(ownImage);
    expect(products.get('GC-RAZER-10')?.categoryId).not.toBe('cat-gift-cards'); // moved to wallets
    expect(products.get('GC-RAZER-25')?.categoryId).toBe('cat-subscriptions'); // owner's choice kept
    expect(products.has('GC-RIOT-25')).toBe(true);
    expect(client.product.update).not.toHaveBeenCalled();
    expect(client.product.upsert).not.toHaveBeenCalled();
  });

  it('v3 adds Mauritanian airtime with a phone input, priced at face value in MRU', async () => {
    const { client, products, prices, currencies } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V5_KEY],
      currencies: [{ code: 'MRU', roundingStep: null }],
    });
    await applyCatalogPack(asClient(client));

    const airtime = [...products.values()].filter((p) => String(p.sku).match(/^TOP-(MATTEL|MAURITEL|CHINGUITEL)-/));
    expect(airtime).toHaveLength(12);
    const mattel200 = products.get('TOP-MATTEL-200')!;
    expect(mattel200.gameId).toBeTruthy();
    expect(prices.get(`${mattel200.id}:MRU`)?.sellPrice).toBe(200);
    expect(mattel200.sellPrice as number).toBeCloseTo(200 / 39.8, 2);

    const games = client.game.create.mock.calls.map(([a]) => a.data).filter((g) => g.slug !== 'claude');
    expect(games.map((g) => g.slug)).toEqual(['mattel', 'mauritel', 'chinguitel']);
    const regex = new RegExp(games[0].inputSchema[0].regex);
    for (const ok of ['22123456', '+22232123456', '44123456']) expect(regex.test(ok)).toBe(true);
    for (const bad of ['12345678', '2212345', 'abc']) expect(regex.test(bad)).toBe(false);

    expect(currencies.get('MRU')?.roundingStep).toBe(1); // whole ouguiya
  });

  it('v3 keeps an owner-chosen MRU rounding and an existing MRU price', async () => {
    const { client, prices, currencies } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V5_KEY],
      currencies: [{ code: 'MRU', roundingStep: 5 }],
      products: [{ sku: 'TOP-MATTEL-100' }],
    });
    prices.set('prod-TOP-MATTEL-100:MRU', { productId: 'prod-TOP-MATTEL-100', currencyCode: 'MRU', sellPrice: 110 });
    await applyCatalogPack(asClient(client));

    expect(prices.get('prod-TOP-MATTEL-100:MRU')?.sellPrice).toBe(110);
    expect(currencies.get('MRU')?.roundingStep).toBe(5);
  });

  it('v4 adds Claude Pro with an account-email input, featured, with art', async () => {
    const { client, products } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V5_KEY],
      categories: ['subscriptions'],
    });
    await applyCatalogPack(asClient(client));

    const claude = products.get('SUB-CLAUDE-PRO-1M')!;
    expect(claude).toMatchObject({ isFeatured: true, categoryId: 'cat-subscriptions', imageUrl: artUrl('SUB-CLAUDE-PRO-1M') });
    expect(claude.sellPrice as number).toBeGreaterThan(claude.costPrice as number);
    const game = client.game.create.mock.calls[0][0].data;
    expect(game).toMatchObject({ slug: 'claude', publisher: 'Anthropic' });
    expect(game.inputSchema[0].key).toBe('email');
    expect(client.category.create).not.toHaveBeenCalled();
  });

  it('never re-adds a product the owner deleted (its SKU still exists)', async () => {
    const { client } = fakePrisma({ products: [{ sku: 'GC-RIOT-10', deletedAt: new Date() }] });
    await applyCatalogPack(asClient(client));

    const created = client.product.create.mock.calls.map(([a]) => a.data.sku);
    expect(created).not.toContain('GC-RIOT-10');
    expect(created).toHaveLength(CATALOG_PACK_SKUS.length - 1);
  });

  it('v5 corrects untouched prices, names and non-existent packs, and leaves owner edits alone', async () => {
    const { client, products } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY],
      products: [
        { sku: 'TOP-MLBB-86', sellPrice: 1.6, costPrice: 1.4, nameAr: 'موبايل ليجندز 86 جوهرة' }, // as v1 left it
        { sku: 'TOP-MLBB-706', sellPrice: 13, costPrice: 11.2 }, // the owner repriced it
        { sku: 'TOP-FF-310', sellPrice: 3.1, isActive: true }, // a pack that does not exist
        { sku: 'TOP-FF-520', sellPrice: 6, isActive: true }, // …but the owner edited this one
        { sku: 'TOP-YALLA-5', sellPrice: 5.4, nameAr: 'يلا لودو شحن بقيمة 5$' },
        { sku: 'TOP-YALLA-10', sellPrice: 10.6, nameAr: 'اسم اختاره المالك' },
      ],
    });
    await applyCatalogPack(asClient(client));

    expect(products.get('TOP-MLBB-86')).toMatchObject({ sellPrice: 1.33, costPrice: 1.21 });
    expect(products.get('TOP-MLBB-706')).toMatchObject({ sellPrice: 13 });
    expect(products.get('TOP-FF-310')?.isActive).toBe(false);
    expect(products.get('TOP-FF-520')?.isActive).toBe(true);
    expect(products.get('TOP-YALLA-5')).toMatchObject({ nameAr: 'يلا لودو 2,320 جوهرة', nameEn: 'Yalla Ludo 2,320 Diamonds' });
    expect(products.get('TOP-YALLA-10')?.nameAr).toBe('اسم اختاره المالك');
    // the real packages that were missing
    for (const sku of ['TOP-PUBG-3850', 'TOP-FF-530', 'APP-TIKTOK-3500', 'SUB-TGPREMIUM-6M', 'GC-PSN-US-100']) expect(products.has(sku)).toBe(true);
  });

  it('v5 adds USDT, Kast and RedotPay top-ups with a network choice, an address check and ouguiya prices', async () => {
    const { client, products, games, prices, categories } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY],
      categories: ['crypto'],
      currencies: [{ code: 'MRU', roundingStep: 1 }],
    });
    await applyCatalogPack(asClient(client));

    const usdt = games.get('usdt-binance') as unknown as { inputSchema: Array<{ key: string; regex?: string; options?: Array<{ value: string }> }> };
    expect(usdt.inputSchema[0].options?.map((o) => o.value)).toEqual(['binance_uid', 'bep20']);
    const address = new RegExp(usdt.inputSchema[1].regex as string);
    expect(address.test('123456789')).toBe(true); // a Binance UID
    expect(address.test('0x' + 'a'.repeat(40))).toBe(true); // a BEP20 address
    expect(address.test('TXYZ')).toBe(false);
    for (const prefix of ['CRYPTO-USDT', 'CRYPTO-KAST', 'CRYPTO-REDOTPAY']) {
      const p = products.get(`${prefix}-20`) as Row;
      expect(p).toMatchObject({ type: 'GAME_TOPUP', delivery: 'MANUAL' });
      expect(p.sellPrice as number).toBeGreaterThan(p.costPrice as number);
      expect(prices.get(`${p.id}:MRU`)?.sellPrice).toBe(900);
    }
    expect(games.has('kast') && games.has('redotpay')).toBe(true);
    expect(categories.get('crypto')).toBeTruthy();
  });

  it('v5 makes airtime numbers match their operator and fixes the Jawaker and Bigo account fields', async () => {
    const { client, games } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY],
      games: ['mattel', 'mauritel', 'chinguitel', 'jawaker', 'bigo-live'],
    });
    await applyCatalogPack(asClient(client));

    const regex = (slug: string) => new RegExp((games.get(slug) as unknown as { inputSchema: Array<{ regex: string }> }).inputSchema[0].regex);
    expect(regex('mattel').test('+22236123456')).toBe(true);
    expect(regex('mattel').test('46123456')).toBe(false);
    expect(regex('mauritel').test('46123456')).toBe(true);
    expect(regex('chinguitel').test('22123456')).toBe(true);
    expect((games.get('jawaker') as unknown as { inputSchema: Array<{ key: string }> }).inputSchema[0].key).toBe('player_id');
    expect((games.get('bigo-live') as unknown as { inputSchema: Array<{ key: string }> }).inputSchema[0].key).toBe('bigo_id');
  });

  it('v5 gives every brand\'s products a three-language guide and each account field its help text', async () => {
    const { client, products, games } = fakePrisma({
      settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY, CATALOG_PACK_V3_KEY, CATALOG_PACK_V4_KEY],
      games: ['pubg-mobile'],
      products: [
        { sku: 'TOP-PUBG-60', sellPrice: 1.1, metadata: null },
        { sku: 'GC-APPLE-US-10', sellPrice: 10.9, metadata: { region: 'US', guide: { after: [{ ar: 'دليل المالك' }] } } },
      ],
    });
    (games.get('pubg-mobile') as Row).inputSchema = [{ key: 'player_id', labelAr: 'x', labelEn: 'x', required: true }];
    await applyCatalogPack(asClient(client));

    const pubg = products.get('TOP-PUBG-60')?.metadata as { guide: { before: Array<{ ar: string; fr: string; en: string }>; warning: object } };
    expect(pubg.guide.before.length).toBeGreaterThan(0);
    expect(pubg.guide.before[0]).toEqual({ ar: expect.any(String), fr: expect.any(String), en: expect.any(String) });
    expect(pubg.guide.warning).toBeTruthy();
    // a guide already there (the owner's) is kept, and other metadata survives
    expect(products.get('GC-APPLE-US-10')?.metadata).toEqual({ region: 'US', guide: { after: [{ ar: 'دليل المالك' }] } });
    const field = (games.get('pubg-mobile') as unknown as { inputSchema: Array<{ helpAr?: string; helpEn?: string }> }).inputSchema[0];
    expect(field.helpAr && field.helpEn).toBeTruthy();
  });

  it('keeps SKUs unique, within the DTO limit, and clear of the retired demo SKUs', () => {
    const demo = ['PUBG-UC-60', 'PUBG-UC-325', 'MLBB-DIA-86', 'GC-ITUNES-50', 'GC-PSN-100', 'SUB-NETFLIX-1M', 'LIC-WIN11-PRO'];
    expect(CATALOG_PACK_SKUS.filter((s) => demo.includes(s))).toEqual([]);
    expect(new Set(CATALOG_PACK_SKUS).size).toBe(CATALOG_PACK_SKUS.length);
    for (const s of CATALOG_PACK_SKUS) expect(s.length).toBeLessThanOrEqual(40);
  });

  it('builds art URLs from STOREFRONT_URL', () => {
    const prev = process.env.STOREFRONT_URL;
    process.env.STOREFRONT_URL = 'https://shop.example.com/';
    expect(artUrl('GC-RIOT-25')).toBe('https://shop.example.com/art/gc-riot-25.svg');
    if (prev === undefined) delete process.env.STOREFRONT_URL;
    else process.env.STOREFRONT_URL = prev;
  });
});
