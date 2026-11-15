import { PrismaClient } from '@prisma/client';
import { applyMicrosoftPack, MICROSOFT_KEYS, MICROSOFT_PACK_KEY } from '../../src/bootstrap/microsoft-pack';
import { floorPrice, maxCost } from '../../src/bootstrap/supplier-pack';

/**
 * The Windows / Office / Microsoft 365 pack on a real Postgres: it waits for
 * GamesDrop, never sells below cost + 10% (fixed MRU price included), warns on
 * every grey key, keeps the owner's existing products, links and deletions,
 * leaves automatic delivery off, and runs once.
 */
describe('Microsoft keys pack (Postgres)', () => {
  const prisma = new PrismaClient();
  let softwareId: string;

  const key = (sku: string) => MICROSOFT_KEYS.find((k) => k.sku === sku)!;

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
    softwareId = (
      await prisma.category.create({ data: { slug: 'software', nameAr: 'البرامج', nameEn: 'Software' } })
    ).id;
  });

  const license = (sku: string, sellPrice: number, extra: Record<string, unknown> = {}) =>
    prisma.product.create({
      data: {
        sku,
        type: 'LICENSE',
        delivery: 'MANUAL',
        nameAr: `اسم المالك ${sku}`,
        nameEn: sku,
        description: 'نص المالك',
        costPrice: 0,
        sellPrice,
        currency: 'USD',
        categoryId: softwareId,
        ...extra,
      },
    });

  it('every key sells above cost + 10% and we never pay as much as we sell for', () => {
    for (const k of MICROSOFT_KEYS) {
      expect(k.sell).toBeGreaterThanOrEqual(floorPrice(k.cost));
      expect(maxCost(k.cost, k.sell)).toBeLessThan(k.sell);
      if (k.grey) expect(k.description).toContain('مفتاح رمادي');
    }
    expect(new Set(MICROSOFT_KEYS.map((k) => k.offer)).size).toBe(MICROSOFT_KEYS.length);
  });

  it('waits for GamesDrop, then adds, links and prices — keeping what the owner made — once', async () => {
    const personal = await license('LIC-M365-PERSONAL-12M', 105);
    await prisma.productPrice.create({
      data: { productId: personal.id, currencyCode: 'MRU', sellPrice: 1000 }, // below 64.51 × 1.1 × 40
    });
    // Family is too cheap for today's cost and carries a 10% discount
    await license('LIC-M365-FAMILY-12M', 100, { discountPercent: 10 });
    await license('LIC-WIN11-PRO', 30, { deletedAt: new Date(), isActive: false });

    expect(await applyMicrosoftPack(prisma)).toBeNull();
    expect(await prisma.systemSetting.findUnique({ where: { key: MICROSOFT_PACK_KEY } })).toBeNull();

    const gd = await prisma.provider.create({
      data: {
        code: 'gamesdrop',
        name: 'GamesDrop',
        baseUrl: 'https://partner.gamesdrop.io',
        apiKeyEnc: 'enc',
      },
    });
    // the owner already linked Windows 11 Home by hand
    const home = await license('LIC-WIN11-HOME', 23);
    await prisma.productProvider.create({
      data: { productId: home.id, providerId: gd.id, providerSku: '99999', providerCost: 21, isActive: true },
    });

    const res = (await applyMicrosoftPack(prisma))!;
    expect(res).toMatchObject({ created: 4, linked: 6, keptOwnerLinks: 1, missing: ['LIC-WIN11-PRO'] });

    // the owner's product keeps its name, text and higher price; MRU is raised to the floor
    const p = await prisma.product.findUniqueOrThrow({ where: { sku: 'LIC-M365-PERSONAL-12M' } });
    expect(p).toMatchObject({ nameAr: 'اسم المالك LIC-M365-PERSONAL-12M', description: 'نص المالك' });
    expect(Number(p.sellPrice)).toBe(105);
    expect(Number(p.costPrice)).toBe(64.51);
    const mru = await prisma.productPrice.findFirstOrThrow({ where: { productId: p.id } });
    expect(Number(mru.sellPrice)).toBe(Math.ceil(floorPrice(64.51) * 40));

    // too cheap: raised so that the price after the discount still clears the floor
    const f = await prisma.product.findUniqueOrThrow({ where: { sku: 'LIC-M365-FAMILY-12M' } });
    expect(Number(f.sellPrice) * 0.9).toBeGreaterThanOrEqual(floorPrice(101.56));

    // new grey keys: shown, licensed, in software, warned, manual, linked with auto off
    const bundle = await prisma.product.findUniqueOrThrow({
      where: { sku: 'LIC-WINOFFICE-PRO24' },
      include: { providers: true },
    });
    expect(bundle).toMatchObject({
      type: 'LICENSE',
      delivery: 'MANUAL',
      isActive: true,
      categoryId: softwareId,
    });
    expect(bundle.description).toContain('مفتاح رمادي');
    expect(bundle.imageUrl).toMatch(/\/art\/lic-winoffice-pro24\.svg$/);
    expect(Number(bundle.sellPrice)).toBe(key('LIC-WINOFFICE-PRO24').sell);
    expect(bundle.providers).toHaveLength(1);
    expect(bundle.providers[0]).toMatchObject({ providerSku: '70650', isActive: false });
    expect(Number(bundle.providers[0].providerCost)).toBe(maxCost(27.43, key('LIC-WINOFFICE-PRO24').sell));

    // the owner's hand-made link stays the only one; a deleted product stays deleted
    const links = await prisma.productProvider.findMany({ where: { productId: home.id } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ providerSku: '99999', isActive: true });
    expect(
      (await prisma.product.findUniqueOrThrow({ where: { sku: 'LIC-WIN11-PRO' } })).deletedAt,
    ).not.toBeNull();
    expect(await prisma.productProvider.count({ where: { isActive: true } })).toBe(1);

    expect(await applyMicrosoftPack(prisma)).toBeNull();
  });
});
