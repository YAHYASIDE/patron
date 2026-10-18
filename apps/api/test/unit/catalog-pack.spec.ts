import { PrismaClient } from '@prisma/client';
import {
  applyCatalogPack,
  artUrl,
  CATALOG_PACK_HIDDEN_SKUS,
  CATALOG_PACK_KEY,
  CATALOG_PACK_SKUS,
  CATALOG_PACK_V2_KEY,
} from '../../src/bootstrap/catalog-pack';

type Row = Record<string, unknown> & { id: string };

/** In-memory stand-in for the tables the packs touch. */
function fakePrisma(seed: { settings?: string[]; categories?: string[]; games?: string[]; products?: Array<Partial<Row> & { sku: string }> } = {}) {
  let n = 0;
  const id = () => `id-${++n}`;
  const settings = new Map((seed.settings ?? []).map((k) => [k, { key: k }]));
  const categories = new Map<string, Row>((seed.categories ?? []).map((s) => [s, { id: `cat-${s}`, slug: s }]));
  const games = new Map<string, Row>((seed.games ?? []).map((s) => [s, { id: `game-${s}`, slug: s }]));
  const products = new Map<string, Row>((seed.products ?? []).map((p) => [p.sku, { id: `prod-${p.sku}`, imageUrl: null, ...p }]));

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
    },
    game: {
      findUnique: jest.fn(({ where }) => Promise.resolve(games.get(where.slug) ?? null)),
      create: jest.fn(({ data }) => {
        const row = { ...data, id: id() };
        games.set(data.slug, row);
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
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $disconnect: jest.fn(),
  };
  return { client, products, settings, categories };
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
    expect(settings.has(CATALOG_PACK_KEY) && settings.has(CATALOG_PACK_V2_KEY)).toBe(true);
  });

  it('creates crypto vouchers and their section hidden', async () => {
    const { client, products, categories } = fakePrisma();
    await applyCatalogPack(asClient(client));

    expect(CATALOG_PACK_HIDDEN_SKUS.length).toBeGreaterThan(0);
    for (const sku of CATALOG_PACK_HIDDEN_SKUS) expect(products.get(sku)?.isActive).toBe(false);
    expect(categories.get('crypto')?.isActive).toBe(false);
  });

  it('does nothing once both markers exist', async () => {
    const { client } = fakePrisma({ settings: [CATALOG_PACK_KEY, CATALOG_PACK_V2_KEY] });
    await applyCatalogPack(asClient(client));

    expect(client.category.create).not.toHaveBeenCalled();
    expect(client.product.create).not.toHaveBeenCalled();
    expect(client.product.updateMany).not.toHaveBeenCalled();
  });

  it('on a store that already has v1 (the live case) only adds v2, fills missing art and keeps the owner image', async () => {
    const ownImage = 'https://example.com/my-own-photo.jpg';
    const { client, products } = fakePrisma({
      settings: [CATALOG_PACK_KEY],
      categories: ['games', 'gift-cards', 'subscriptions', 'software', 'apps-topup'],
      products: [
        { sku: 'TOP-PUBG-660', imageUrl: null },
        { sku: 'GC-APPLE-US-25', imageUrl: ownImage },
        { sku: 'GC-RAZER-10', categoryId: 'cat-gift-cards' },
        { sku: 'GC-RAZER-25', categoryId: 'cat-subscriptions' }, // re-filed by the owner
      ],
    });
    await applyCatalogPack(asClient(client));

    expect(client.game.create).not.toHaveBeenCalled(); // v1 skipped
    expect(products.get('TOP-PUBG-660')?.imageUrl).toBe(artUrl('TOP-PUBG-660'));
    expect(products.get('GC-APPLE-US-25')?.imageUrl).toBe(ownImage);
    expect(products.get('GC-RAZER-10')?.categoryId).not.toBe('cat-gift-cards'); // moved to wallets
    expect(products.get('GC-RAZER-25')?.categoryId).toBe('cat-subscriptions'); // owner's choice kept
    expect(products.has('GC-RIOT-25')).toBe(true);
    expect(client.product.update).not.toHaveBeenCalled();
    expect(client.product.upsert).not.toHaveBeenCalled();
  });

  it('never re-adds a product the owner deleted (its SKU still exists)', async () => {
    const { client } = fakePrisma({ products: [{ sku: 'GC-RIOT-10', deletedAt: new Date() }] });
    await applyCatalogPack(asClient(client));

    const created = client.product.create.mock.calls.map(([a]) => a.data.sku);
    expect(created).not.toContain('GC-RIOT-10');
    expect(created).toHaveLength(CATALOG_PACK_SKUS.length - 1);
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
