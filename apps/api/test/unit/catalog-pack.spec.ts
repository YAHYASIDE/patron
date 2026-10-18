import { PrismaClient } from '@prisma/client';
import { applyCatalogPack, CATALOG_PACK_KEY, CATALOG_PACK_SKUS } from '../../src/bootstrap/catalog-pack';

/** In-memory stand-in for the four tables the pack touches. */
function fakePrisma(seed: { settings?: string[]; categories?: string[]; games?: string[]; skus?: string[] } = {}) {
  let n = 0;
  const id = () => `id-${++n}`;
  const settings = new Map((seed.settings ?? []).map((k) => [k, { key: k }]));
  const categories = new Map((seed.categories ?? []).map((s) => [s, { id: `cat-${s}`, slug: s }]));
  const games = new Map((seed.games ?? []).map((s) => [s, { id: `game-${s}`, slug: s }]));
  const products = new Map((seed.skus ?? []).map((s) => [s, { id: `prod-${s}`, sku: s }]));

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
        const row = { ...data, id: id() };
        products.set(data.sku, row);
        return Promise.resolve(row);
      }),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    $disconnect: jest.fn(),
  };
  return { client, products, settings };
}

describe('applyCatalogPack', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('creates every product as MANUAL delivery in USD, priced at or above cost', async () => {
    const { client, products, settings } = fakePrisma();
    await applyCatalogPack(client as unknown as PrismaClient);

    expect(products.size).toBe(CATALOG_PACK_SKUS.length);
    for (const p of products.values() as Iterable<Record<string, unknown>>) {
      expect(p.delivery).toBe('MANUAL');
      expect(p.currency).toBe('USD');
      expect(p.sellPrice as number).toBeGreaterThanOrEqual(p.costPrice as number);
      expect(p.categoryId).toBeTruthy();
      // game top-ups must be linked to a game (the API enforces this too)
      if (p.type === 'GAME_TOPUP') expect(p.gameId).toBeTruthy();
    }
    expect(settings.has(CATALOG_PACK_KEY)).toBe(true);
  });

  it('does nothing once the marker exists', async () => {
    const { client } = fakePrisma({ settings: [CATALOG_PACK_KEY] });
    await applyCatalogPack(client as unknown as PrismaClient);

    expect(client.category.create).not.toHaveBeenCalled();
    expect(client.product.create).not.toHaveBeenCalled();
  });

  it('is insert-only: existing (or soft-deleted) SKUs, categories and games are never modified or re-added', async () => {
    const kept = CATALOG_PACK_SKUS[0];
    const { client } = fakePrisma({ categories: ['games'], games: ['pubg-mobile'], skus: [kept] });
    await applyCatalogPack(client as unknown as PrismaClient);

    const createdSkus = client.product.create.mock.calls.map(([arg]) => arg.data.sku);
    expect(createdSkus).not.toContain(kept);
    expect(createdSkus).toHaveLength(CATALOG_PACK_SKUS.length - 1);
    expect(client.category.create.mock.calls.map(([a]) => a.data.slug)).not.toContain('games');
    expect(client.game.create.mock.calls.map(([a]) => a.data.slug)).not.toContain('pubg-mobile');
    expect(client.product.update).not.toHaveBeenCalled();
    expect(client.product.upsert).not.toHaveBeenCalled();
  });

  it('never reuses a retired demo SKU (those rows still exist, soft-deleted)', () => {
    const demo = ['PUBG-UC-60', 'PUBG-UC-325', 'MLBB-DIA-86', 'GC-ITUNES-50', 'GC-PSN-100', 'SUB-NETFLIX-1M', 'LIC-WIN11-PRO'];
    expect(CATALOG_PACK_SKUS.filter((s) => demo.includes(s))).toEqual([]);
    expect(new Set(CATALOG_PACK_SKUS).size).toBe(CATALOG_PACK_SKUS.length);
    for (const s of CATALOG_PACK_SKUS) expect(s.length).toBeLessThanOrEqual(40); // DTO limit
  });
});
