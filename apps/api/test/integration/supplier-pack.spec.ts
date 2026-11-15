import { PrismaClient } from '@prisma/client';
import {
  applyBinancePack,
  applySupplierPack,
  ceilCents,
  floorPrice,
  GAMESDROP_LINKS,
  GAMESDROP_NEW,
  listPriceFor,
  maxCost,
  showNewSupplierProducts,
  SUPPLIER_PACK_KEY,
} from '../../src/bootstrap/supplier-pack';

/**
 * The GamesDrop links pack on a real Postgres: it waits for the supplier to be
 * connected, never lets a linked product sell below cost + 10% (discount and
 * fixed foreign prices included), leaves automatic delivery off, creates new
 * products hidden, respects the owner's own links and deletions, and runs once.
 */
describe('GamesDrop supplier pack (Postgres)', () => {
  const prisma = new PrismaClient();
  let categoryId: string;
  let gameId: string;

  const cost = (sku: string) => GAMESDROP_LINKS.find(([s]) => s === sku)![2];
  const offer = (sku: string) => GAMESDROP_LINKS.find(([s]) => s === sku)![1];

  async function product(sku: string, sellPrice: number, extra: Record<string, unknown> = {}) {
    return prisma.product.create({
      data: {
        sku,
        type: 'GAME_TOPUP',
        delivery: 'MANUAL',
        nameAr: sku,
        nameEn: sku,
        costPrice: 0,
        sellPrice,
        currency: 'USD',
        categoryId,
        gameId,
        imageUrl: `https://img/${sku}.svg`,
        metadata: { brand: sku },
        ...extra,
      },
    });
  }

  const provider = () =>
    prisma.provider.create({
      data: {
        code: 'gamesdrop',
        name: 'GamesDrop',
        baseUrl: 'https://partner.gamesdrop.io',
        apiKeyEnc: 'enc',
      },
    });

  beforeAll(() => prisma.$connect());
  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.create({
      data: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    await prisma.currency.create({
      data: { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', roundingStep: 1 },
    });
    await prisma.fxRate.create({ data: { baseCurrency: 'USD', quoteCurrency: 'MRU', rate: 40 } });
    categoryId = (await prisma.category.create({ data: { slug: 'games', nameAr: 'ألعاب', nameEn: 'Games' } }))
      .id;
    gameId = (
      await prisma.game.create({
        data: { slug: 'mobile-legends', nameAr: 'موبايل ليجندز', nameEn: 'Mobile Legends', categoryId },
      })
    ).id;
  });

  it('price rules: at least cost + 10% after the discount; we never pay as much as we sell for', () => {
    expect(ceilCents(0.1 + 0.2)).toBe(0.3);
    expect(floorPrice(0.92)).toBe(1.02);
    expect(listPriceFor(24.91, 10)).toBe(30.46); // 30.46 − 10% = 27.41 ≥ 24.91 × 1.1
    expect(maxCost(0.92, 1.02)).toBe(0.95);
    expect(maxCost(10, 10.2)).toBe(10.19); // the slack never reaches the selling price
    for (const [, , c] of GAMESDROP_LINKS) expect(maxCost(c, floorPrice(c))).toBeLessThan(floorPrice(c));
    expect(new Set(GAMESDROP_NEW.map((n) => n.sku)).size).toBe(GAMESDROP_NEW.length);
  });

  it('waits, without a marker, until GamesDrop is connected', async () => {
    await product('TOP-PUBG-60', 1.01);
    expect(await applySupplierPack(prisma)).toBeNull();
    expect(await prisma.systemSetting.findUnique({ where: { key: SUPPLIER_PACK_KEY } })).toBeNull();
    expect(await prisma.productProvider.count()).toBe(0);
  });

  it('links, raises only what is too low, protects discounts and MRU prices, creates new products hidden — once', async () => {
    const gd = await provider();
    const pubg = await product('TOP-PUBG-60', 1.01);
    await prisma.productPrice.create({ data: { productId: pubg.id, currencyCode: 'MRU', sellPrice: 30 } });
    const roblox = await product('GC-ROBLOX-25', 24.84, { discountPercent: 10 });
    const nitro = await product('SUB-DISCORD-NITRO-12M', 109.99);
    const bigo = await product('APP-BIGO-200', 4.31);
    await prisma.productProvider.create({
      data: { productId: bigo.id, providerId: gd.id, providerSku: '9999', providerCost: 4, isActive: true },
    });
    await product('TOP-MLBB-86', 1.33);
    await product('TOP-MLBB-344', 9, { deletedAt: new Date() });

    const res = (await applySupplierPack(prisma))!;
    expect(res).toMatchObject({ keptOwnerLinks: 1 });

    // too low → raised to cost + 10%; MRU 30 → 1.02 × 40 = 40.8 → 41 (whole ouguiya)
    expect(Number((await prisma.product.findUniqueOrThrow({ where: { id: pubg.id } })).sellPrice)).toBe(1.02);
    expect(
      Number((await prisma.productPrice.findFirstOrThrow({ where: { productId: pubg.id } })).sellPrice),
    ).toBe(41);
    // the discount is kept and the price after it still clears the floor
    const r = await prisma.product.findUniqueOrThrow({ where: { id: roblox.id } });
    expect(Number(r.sellPrice) * 0.9).toBeGreaterThanOrEqual(floorPrice(cost('GC-ROBLOX-25')));
    expect(r.discountPercent).toBe(10);
    // a healthy margin is never lowered; reference cost follows the supplier
    const n = await prisma.product.findUniqueOrThrow({ where: { id: nitro.id } });
    expect(Number(n.sellPrice)).toBe(109.99);
    expect(Number(n.costPrice)).toBe(cost('SUB-DISCORD-NITRO-12M'));

    // links: automatic delivery off, most-we-pay below the selling price
    const link = await prisma.productProvider.findFirstOrThrow({ where: { productId: pubg.id } });
    expect(link).toMatchObject({ providerSku: offer('TOP-PUBG-60'), isActive: false });
    expect(Number(link.providerCost)).toBeLessThan(1.02);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: pubg.id } })).delivery).toBe('MANUAL');
    // the owner's own link is untouched
    expect(await prisma.productProvider.findFirstOrThrow({ where: { productId: bigo.id } })).toMatchObject({
      providerSku: '9999',
      isActive: true,
    });

    // new products: hidden, manual, shaped like their brand sibling, priced at cost + 10%, linked
    const weekly = await prisma.product.findUniqueOrThrow({
      where: { sku: 'TOP-MLBB-WEEKLY' },
      include: { providers: true },
    });
    const spec = GAMESDROP_NEW.find((x) => x.sku === 'TOP-MLBB-WEEKLY')!;
    expect(weekly).toMatchObject({
      isActive: false,
      delivery: 'MANUAL',
      categoryId,
      gameId,
      imageUrl: 'https://img/TOP-MLBB-86.svg',
    });
    expect(Number(weekly.sellPrice)).toBe(floorPrice(spec.cost));
    expect(weekly.providers).toEqual([expect.objectContaining({ providerSku: spec.offer, isActive: false })]);
    // a product the owner deleted is never brought back; products the shop lacks are reported, not invented
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { sku: 'TOP-MLBB-344' } })).deletedAt,
    ).not.toBeNull();
    expect(res.missing).toEqual(expect.arrayContaining(['TOP-MLBB-344', 'GC-APPLE-US-5', 'TOP-FF-100']));

    // every change is on record, and a second start does nothing
    const marker = await prisma.systemSetting.findUniqueOrThrow({ where: { key: SUPPLIER_PACK_KEY } });
    expect((marker.value as { changes: unknown[] }).changes).toEqual(
      expect.arrayContaining([
        { sku: 'TOP-PUBG-60', currency: 'USD', from: 1.01, to: 1.02 },
        { sku: 'TOP-PUBG-60', currency: 'MRU', from: 30, to: 41 },
      ]),
    );
    const links = await prisma.productProvider.count();
    expect(await applySupplierPack(prisma)).toBeNull();
    expect(await prisma.productProvider.count()).toBe(links);
  });
  it('shows the new products once, after the links pack, never a deleted one or one hidden again later', async () => {
    expect(await showNewSupplierProducts(prisma)).toBeNull(); // nothing created yet
    await provider();
    await product('TOP-MLBB-86', 1.33);
    await product('TOP-MLBB-344', 9, { deletedAt: new Date(), isActive: false });
    await applySupplierPack(prisma);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'TOP-MLBB-WEEKLY' } })).isActive).toBe(
      false,
    );

    const shown = await showNewSupplierProducts(prisma);
    expect(shown).toBe(6); // the six Mobile Legends products whose sibling exists, minus the deleted one
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'TOP-MLBB-WEEKLY' } })).isActive).toBe(
      true,
    );
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'TOP-MLBB-344' } })).isActive).toBe(false);

    // the owner hides one again: a later start leaves it hidden
    await prisma.product.update({ where: { sku: 'TOP-MLBB-WEEKLY' }, data: { isActive: false } });
    expect(await showNewSupplierProducts(prisma)).toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: 'TOP-MLBB-WEEKLY' } })).isActive).toBe(
      false,
    );
  });
  it('Binance cards: linked, priced above cost, shown, described as a code; only the 1 USDT card buys automatically — once', async () => {
    await product('GC-BINANCE-10', 10.6, { isActive: false, type: 'GIFT_CARD', description: 'old' });
    expect(await applyBinancePack(prisma)).toBeNull(); // waits for GamesDrop
    await provider();

    const res = (await applyBinancePack(prisma))!;
    expect(res).toMatchObject({ created: 4, linked: 5, auto: 1, shown: 1 });
    const cards = await prisma.product.findMany({
      where: { sku: { startsWith: 'GC-BINANCE-' } },
      include: { providers: true },
    });
    expect(cards).toHaveLength(5);
    for (const c of cards) {
      expect(c.isActive).toBe(true);
      expect(Number(c.providers[0].providerCost)).toBeLessThan(Number(c.sellPrice));
      expect(c.description).toContain('Redeem');
    }
    const one = cards.find((c) => c.sku === 'GC-BINANCE-1')!;
    expect(one).toMatchObject({ delivery: 'AUTO_PROVIDER', type: 'GIFT_CARD', categoryId, gameId });
    expect(Number(one.sellPrice)).toBe(floorPrice(1.28));
    expect(one.providers[0]).toMatchObject({ providerSku: '34262', isActive: true });
    const ten = cards.find((c) => c.sku === 'GC-BINANCE-10')!;
    expect(Number(ten.sellPrice)).toBe(floorPrice(11.4)); // 10.6 raised to 12.54
    expect(ten).toMatchObject({ delivery: 'MANUAL' });
    expect(ten.providers[0]).toMatchObject({ providerSku: '17449', isActive: false });

    expect(await applyBinancePack(prisma)).toBeNull();
    expect(await prisma.productProvider.count()).toBe(5);
  });
});
