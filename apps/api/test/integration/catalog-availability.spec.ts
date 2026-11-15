import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { ReferenceService } from '../../src/common/reference/reference.service';
import { PricingService } from '../../src/modules/catalog/pricing.service';
import { ProductsService } from '../../src/modules/catalog/products.service';
import { QuotesService } from '../../src/modules/orders/quotes.service';

/**
 * The owner's rule (15 Nov 2026) on a real database: a MANUAL product with no
 * supplier link, no code stock and no «أسلّمه بنفسي» stays listed but greyed
 * (`inStock: false`), and checkout refuses it; each way to deliver it makes it
 * orderable again. The aggregate queries (relation filter on the supplier,
 * code expiry) are exactly what a mocked Prisma cannot prove.
 */
describe('Catalogue availability (MANUAL products)', () => {
  let prisma: PrismaService;
  let products: ProductsService;
  let quotes: QuotesService;
  let categoryId: string;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const pricing = new PricingService(prisma, { get: () => undefined } as any);
    const crypto = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);
    products = new ProductsService(prisma, pricing);
    quotes = new QuotesService(prisma, pricing, crypto, new ReferenceService(prisma));
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.create({ data: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true } });
    categoryId = (await prisma.category.create({ data: { slug: 'cards', nameAr: 'بطاقات', nameEn: 'Cards' } })).id;
    userId = (
      await prisma.user.create({ data: { phone: '+22222000001', fullName: 'زبون', phoneVerifiedAt: new Date() } })
    ).id;
  });

  const manual = (sku: string, over: Record<string, unknown> = {}) =>
    prisma.product.create({
      data: {
        sku, type: 'GIFT_CARD', delivery: 'MANUAL', nameAr: sku, nameEn: sku,
        costPrice: 1, sellPrice: 2, currency: 'USD', categoryId, ...over,
      },
    });
  const supplier = (code: string, isActive: boolean) =>
    prisma.provider.create({ data: { code, name: code, baseUrl: 'https://supplier.test', apiKeyEnc: 'x', isActive } });
  const quote = (productId: string) => quotes.create(userId, { currency: 'USD', items: [{ productId, quantity: 1 }] } as any);

  it('lists every product, greys out the ones nobody can deliver, and checkout agrees', async () => {
    const none = await manual('NONE');
    const self = await manual('TOP-MATTEL-100', { selfDelivery: true });
    const linked = await manual('LINKED');
    const deadLink = await manual('DEAD-LINK');
    const codes = await manual('CODES');
    const expired = await manual('EXPIRED-CODES');
    const soldOut = await manual('SELF-SOLD-OUT', { selfDelivery: true, stockQty: 0 });

    const live = await supplier('live', true);
    const off = await supplier('off', false);
    // automatic delivery off on the link: the owner buys from the supplier by hand
    await prisma.productProvider.create({ data: { productId: linked.id, providerId: live.id, providerSku: 'L1', providerCost: 1, isActive: false } });
    await prisma.productProvider.create({ data: { productId: deadLink.id, providerId: off.id, providerSku: 'D1', providerCost: 1 } });
    await prisma.productCode.create({ data: { productId: codes.id, codeEnc: 'enc-1', codeHash: 'h1' } });
    await prisma.productCode.create({
      data: { productId: expired.id, codeEnc: 'enc-2', codeHash: 'h2', expiresAt: new Date(Date.now() - 60_000) },
    });

    const page = await products.findAllPublic({ page: 1, limit: 50, skip: 0 } as any);
    const listed = Object.fromEntries(page.data.map((p: any) => [p.sku, p.inStock]));
    expect(listed).toEqual({
      NONE: false,
      'TOP-MATTEL-100': true,
      LINKED: true,
      'DEAD-LINK': false,
      CODES: true,
      'EXPIRED-CODES': false,
      'SELF-SOLD-OUT': false,
    });
    expect(page.data.every((p: any) => p.selfDelivery === undefined && p.costPrice === undefined)).toBe(true);

    // the detail page and the admin list say the same
    for (const p of [none, self, linked, deadLink, codes, expired, soldOut]) {
      expect((await products.findOnePublic(p.sku)).inStock).toBe(listed[p.sku]);
    }
    const admin = await products.findAllAdmin({ page: 1, limit: 50, skip: 0 } as any);
    expect(Object.fromEntries(admin.data.map((p: any) => [p.sku, p.inStock]))).toEqual(listed);

    // checkout refuses what the store greys out, with the code the store already handles
    for (const p of [none, deadLink, expired]) {
      await expect(quote(p.id)).rejects.toMatchObject({
        response: { error: 'PRODUCT_UNAVAILABLE', productId: p.id, productNameAr: p.nameAr },
      });
    }
    await expect(quote(soldOut.id)).rejects.toMatchObject({ response: { error: 'OUT_OF_STOCK', available: 0 } });
    for (const p of [self, linked, codes]) {
      await expect(quote(p.id)).resolves.toMatchObject({ items: [expect.objectContaining({ productId: p.id })] });
    }
  });

  it('the owner switching «أسلّمه بنفسي» on makes a greyed product orderable', async () => {
    const p = await manual('NETFLIX-25');
    expect((await products.findOnePublic(p.sku)).inStock).toBe(false);

    await products.update(p.id, { selfDelivery: true } as any, userId);
    expect((await products.findOnePublic(p.sku)).inStock).toBe(true);
    await expect(quote(p.id)).resolves.toBeDefined();
  });
});
