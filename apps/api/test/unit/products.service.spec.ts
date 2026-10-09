import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeliveryMode, Prisma } from '@prisma/client';
import { ProductsService } from '../../src/modules/catalog/products.service';

const D = (v: any) => new Prisma.Decimal(v);

const query = (over: Partial<any> = {}) =>
  ({ page: 1, limit: 20, skip: 0, order: 'desc', ...over }) as any;

const product = (over: Partial<any> = {}) => ({
  id: 'p1', sku: 'SKU1', nameEn: 'Item', nameAr: 'عنصر',
  categoryId: 'c1', gameId: null, type: 'GIFT_CARD',
  delivery: DeliveryMode.MANUAL, stockQty: 5,
  sellPrice: D('10'), costPrice: D('4'),
  deletedAt: null, isActive: true, prices: [], ...over,
});

describe('ProductsService', () => {
  let prisma: any;
  let pricing: any;
  let service: ProductsService;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue([product()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(product()),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'p-new', ...data })),
        update: jest.fn().mockImplementation((args: any) => Promise.resolve({ id: 'p1', ...args.data })),
      },
      productCode: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      productProvider: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      productPrice: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({}),
      },
      orderItem: { count: jest.fn().mockResolvedValue(0) },
      category: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
      game: { findFirst: jest.fn().mockResolvedValue({ id: 'g1' }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
    };
    pricing = {
      baseCurrency: 'USD',
      assertSupported: jest.fn().mockResolvedValue({ code: 'USD' }),
      pricingContext: jest.fn().mockResolvedValue({ currency: {}, rate: D(1), fxRateId: 'fx1', markup: D(1) }),
      priceLoadedProduct: jest.fn().mockResolvedValue({ amount: D('10'), currency: 'USD', isOverride: false }),
      priceProduct: jest.fn().mockResolvedValue({ amount: D('10'), currency: 'USD', isOverride: false }),
    };
    service = new ProductsService(prisma, pricing);
  });

  describe('findAllPublic', () => {
    it('defaults to the base currency and asserts it is supported', async () => {
      await service.findAllPublic(query());
      expect(pricing.assertSupported).toHaveBeenCalledWith('USD');
    });

    it('honours the requested currency and filters to active, non-deleted rows', async () => {
      await service.findAllPublic(query({ currency: 'EUR', categoryId: 'c1', gameId: 'g2', type: 'GIFT_CARD', isFeatured: true, search: 'card' }));
      expect(pricing.assertSupported).toHaveBeenCalledWith('EUR');
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ deletedAt: null, isActive: true, categoryId: 'c1', gameId: 'g2', type: 'GIFT_CARD', isFeatured: true });
      expect(where.OR).toEqual([
        { nameEn: { contains: 'card', mode: 'insensitive' } },
        { nameAr: { contains: 'card' } },
        { sku: { contains: 'card', mode: 'insensitive' } },
      ]);
    });

    it('strips cost, prices the page and reports stock', async () => {
      const res = await service.findAllPublic(query());
      expect(pricing.pricingContext).toHaveBeenCalledWith('USD');
      const row = res.data[0] as any;
      expect(row.costPrice).toBeUndefined();
      expect(row.prices).toBeUndefined();
      expect(row.sellPrice).toEqual(D('10'));
      expect(row.currency).toBe('USD');
      expect(row.priceIsOverride).toBe(false);
      // MANUAL delivery with stockQty 5 -> in stock
      expect(row.inStock).toBe(true);
      expect(res.meta.total).toBe(1);
    });

    it('derives CODE_POOL stock from unused inventory counts', async () => {
      prisma.product.findMany.mockResolvedValue([
        product({ id: 'a', delivery: DeliveryMode.CODE_POOL }),
        product({ id: 'b', delivery: DeliveryMode.CODE_POOL }),
      ]);
      prisma.product.count.mockResolvedValue(2);
      prisma.productCode.groupBy.mockResolvedValue([{ productId: 'a', _count: { _all: 3 } }]);

      const res = await service.findAllPublic(query());
      const byId = new Map(res.data.map((r: any) => [r.id, r.inStock]));
      expect(byId.get('a')).toBe(true);  // has unused codes
      expect(byId.get('b')).toBe(false); // none in groupBy result -> out of stock
    });

    it('derives AUTO_PROVIDER stock from healthy providers', async () => {
      prisma.product.findMany.mockResolvedValue([
        product({ id: 'a', delivery: DeliveryMode.AUTO_PROVIDER }),
        product({ id: 'b', delivery: DeliveryMode.AUTO_PROVIDER }),
      ]);
      prisma.product.count.mockResolvedValue(2);
      prisma.productProvider.groupBy.mockResolvedValue([{ productId: 'b', _count: { _all: 1 } }]);

      const res = await service.findAllPublic(query());
      const byId = new Map(res.data.map((r: any) => [r.id, r.inStock]));
      expect(byId.get('a')).toBe(false);
      expect(byId.get('b')).toBe(true);
    });

    it('treats a null stockQty as unlimited for MANUAL products', async () => {
      prisma.product.findMany.mockResolvedValue([
        product({ id: 'a', delivery: DeliveryMode.MANUAL, stockQty: null }),
        product({ id: 'b', delivery: DeliveryMode.MANUAL, stockQty: 0 }),
      ]);
      prisma.product.count.mockResolvedValue(2);
      const res = await service.findAllPublic(query());
      const byId = new Map(res.data.map((r: any) => [r.id, r.inStock]));
      expect(byId.get('a')).toBe(true);
      expect(byId.get('b')).toBe(false);
    });
  });

  describe('findOnePublic', () => {
    it('returns a priced, cost-stripped product resolved by id or sku', async () => {
      const res: any = await service.findOnePublic('SKU1');
      const where = prisma.product.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ id: 'SKU1' }, { sku: 'SKU1' }]);
      expect(res.costPrice).toBeUndefined();
      expect(res.sellPrice).toEqual(D('10'));
      expect(pricing.priceProduct).toHaveBeenCalledWith('p1', 'USD');
    });

    it('uses the requested currency', async () => {
      await service.findOnePublic('SKU1', 'EUR');
      expect(pricing.priceProduct).toHaveBeenCalledWith('p1', 'EUR');
    });

    it('throws NotFound for a missing or inactive product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.findOnePublic('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('checks CODE_POOL stock via unused-code count', async () => {
      prisma.product.findFirst.mockResolvedValue(product({ delivery: DeliveryMode.CODE_POOL }));
      prisma.productCode.count.mockResolvedValue(2);
      const res: any = await service.findOnePublic('p1');
      expect(res.inStock).toBe(true);
      expect(prisma.productCode.count).toHaveBeenCalledWith({ where: { productId: 'p1', isUsed: false } });
    });

    it('checks AUTO_PROVIDER stock via healthy-provider count', async () => {
      prisma.product.findFirst.mockResolvedValue(product({ delivery: DeliveryMode.AUTO_PROVIDER }));
      prisma.productProvider.count.mockResolvedValue(0);
      const res: any = await service.findOnePublic('p1');
      expect(res.inStock).toBe(false);
    });
  });

  describe('findAllAdmin', () => {
    it('includes cost and computes margin percent', async () => {
      const res: any = await service.findAllAdmin(query());
      // margin = (10 - 4) / 10 * 100 = 60
      expect(res.data[0].marginPercent.toString()).toBe('60');
      expect(res.data[0].costPrice).toEqual(D('4'));
    });

    it('guards against divide-by-zero when sellPrice is 0', async () => {
      prisma.product.findMany.mockResolvedValue([product({ sellPrice: D('0'), costPrice: D('0') })]);
      const res: any = await service.findAllAdmin(query());
      expect(res.data[0].marginPercent.toString()).toBe('0');
    });

    it('filters by isActive and search on name/sku', async () => {
      await service.findAllAdmin(query({ isActive: false, search: 'sku', gameId: 'g1', type: 'GIFT_CARD' }));
      const where = prisma.product.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBe(false);
      expect(where.gameId).toBe('g1');
      expect(where.OR).toEqual([
        { nameEn: { contains: 'sku', mode: 'insensitive' } },
        { sku: { contains: 'sku', mode: 'insensitive' } },
      ]);
    });
  });

  describe('create', () => {
    const dto = () => ({
      sku: 'NEW', type: 'GIFT_CARD', delivery: DeliveryMode.MANUAL,
      nameEn: 'N', nameAr: 'N', categoryId: 'c1', costPrice: 4, sellPrice: 10,
    }) as any;

    it('creates the product in the base currency and audits it', async () => {
      const res: any = await service.create(dto(), 'admin1');
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data.currency).toBe('USD');
      expect(data.prices).toBeUndefined();
      expect(res.sku).toBe('NEW');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'catalog.product.create' }) }),
      );
    });

    it('nests price overrides when supplied and validates each currency', async () => {
      await service.create({ ...dto(), prices: [{ currencyCode: 'EUR', sellPrice: 9 }] }, 'admin1');
      expect(pricing.assertSupported).toHaveBeenCalledWith('EUR');
      const data = prisma.product.create.mock.calls[0][0].data;
      expect(data.prices).toEqual({ create: [{ currencyCode: 'EUR', sellPrice: 9 }] });
    });

    it('rejects a product that would sell below cost', async () => {
      await expect(service.create({ ...dto(), sellPrice: 3, costPrice: 4 }, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid categoryId', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.create(dto(), 'admin1')).rejects.toThrow('Invalid categoryId');
    });

    it('rejects an invalid gameId', async () => {
      prisma.game.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...dto(), gameId: 'bad' }, 'admin1')).rejects.toThrow('Invalid gameId');
    });

    it('requires a game link for GAME_TOPUP products', async () => {
      await expect(service.create({ ...dto(), type: 'GAME_TOPUP' }, 'admin1')).rejects.toThrow('GAME_TOPUP');
    });
  });

  describe('update', () => {
    it('updates scalars and audits before/after', async () => {
      const res: any = await service.update('p1', { nameEn: 'Renamed', categoryId: 'c1' } as any, 'admin1');
      expect(prisma.product.update).toHaveBeenCalled();
      expect(res.nameEn).toBe('Renamed');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'catalog.product.update' }) }),
      );
    });

    it('throws NotFound when the product is missing', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', { categoryId: 'c1' } as any, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces price overrides transactionally', async () => {
      await service.update('p1', { categoryId: 'c1', prices: [{ currencyCode: 'EUR', sellPrice: 8 }] } as any, 'admin1');
      expect(pricing.assertSupported).toHaveBeenCalledWith('EUR');
      expect(prisma.productPrice.deleteMany).toHaveBeenCalledWith({ where: { productId: 'p1' } });
      expect(prisma.productPrice.createMany).toHaveBeenCalledWith({ data: [{ currencyCode: 'EUR', sellPrice: 8, productId: 'p1' }] });
    });

    it('leaves prices untouched when the dto omits them', async () => {
      await service.update('p1', { categoryId: 'c1' } as any, 'admin1');
      expect(prisma.productPrice.deleteMany).not.toHaveBeenCalled();
      expect(prisma.productPrice.createMany).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft-deletes when no fulfilment is in flight', async () => {
      const res = await service.remove('p1', 'admin1');
      const call = prisma.product.update.mock.calls[0][0];
      expect(call.data.isActive).toBe(false);
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(res).toEqual({ message: 'Product deleted' });
    });

    it('refuses to delete while order items are pending/processing', async () => {
      prisma.orderItem.count.mockResolvedValue(2);
      await expect(service.remove('p1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });
  });
});
