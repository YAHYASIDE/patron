import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DeliveryMode, Prisma, QuoteStatus } from '@prisma/client';
import { QuotesService } from '../../src/modules/orders/quotes.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** A product row as `priceItem` expects it back from prisma.product.findFirst. */
const makeProduct = (over: Partial<any> = {}) => ({
  id: 'p1',
  nameAr: 'منتج',
  nameEn: 'Product',
  maxPerOrder: 10,
  delivery: DeliveryMode.MANUAL,
  stockQty: null,
  costPrice: D(2),
  game: null,
  providers: [],
  ...over,
});

/** A persisted quote row as tx.checkoutQuote.create returns it. */
const makeQuoteRow = (over: Partial<any> = {}) => ({
  id: 'q1',
  userId: 'u1',
  status: QuoteStatus.ACTIVE,
  expiresAt: new Date(Date.now() + 15 * 60_000),
  items: [
    {
      id: 'qi1',
      inputs: [
        { fieldKey: 'player', fieldLabel: 'Player', value: 'ABC', isSensitive: false },
        { fieldKey: 'pin', fieldLabel: 'PIN', value: 'enc:1234', isSensitive: true },
      ],
    },
  ],
  ...over,
});

describe('QuotesService', () => {
  let prisma: any;
  let pricing: any;
  let crypto: any;
  let reference: any;
  let tx: any;
  let service: QuotesService;

  beforeEach(() => {
    tx = {
      checkoutQuote: { create: jest.fn().mockResolvedValue(makeQuoteRow()) },
    };
    prisma = {
      user: { findFirstOrThrow: jest.fn().mockResolvedValue({ id: 'u1', defaultCurrency: 'USD' }) },
      product: { findFirst: jest.fn().mockResolvedValue(makeProduct()) },
      productCode: { count: jest.fn().mockResolvedValue(100) },
      productProvider: { count: jest.fn().mockResolvedValue(1) },
      coupon: { findUnique: jest.fn() },
      order: { count: jest.fn().mockResolvedValue(0) },
      checkoutQuote: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    pricing = {
      baseCurrency: 'USD',
      assertSupported: jest.fn().mockResolvedValue({ decimals: 2 }),
      priceProduct: jest.fn().mockResolvedValue({ amount: D(10), baseAmount: D(10) }),
      getRate: jest.fn().mockResolvedValue({ rate: D(1), id: 'fx1' }),
      convert: jest.fn().mockResolvedValue({ amount: D(5) }),
    };
    crypto = { encrypt: jest.fn((v: string) => `enc:${v}`) };
    reference = { quote: jest.fn().mockResolvedValue('Q-0001') };

    service = new QuotesService(prisma, pricing, crypto, reference);
  });

  const dto = (over: Partial<any> = {}): any => ({
    items: [{ productId: 'p1', quantity: 2 }],
    ...over,
  });

  describe('create', () => {
    it('freezes totals and builds the quote from priced items', async () => {
      const res = await service.create('u1', dto());

      expect(pricing.assertSupported).toHaveBeenCalledWith('USD');
      const data = tx.checkoutQuote.create.mock.calls[0][0].data;
      expect(data.subtotal.toString()).toBe('20'); // 10 * 2
      expect(data.total.toString()).toBe('20');
      expect(data.discount.toString()).toBe('0');
      expect(data.totalCostBase.toString()).toBe('4'); // costPrice 2 * qty 2
      expect(data.currency).toBe('USD');
      expect(data.fxRate.toString()).toBe('1');
      expect(data.totalBase.toString()).toBe('20');
      expect(data.quoteNumber).toBe('Q-0001');
      expect(res.secondsRemaining).toBeGreaterThan(0);
      expect(res.isExpired).toBe(false);
    });

    it('falls back to the user default currency when none is supplied', async () => {
      await service.create('u1', dto({ currency: undefined }));
      expect(pricing.assertSupported).toHaveBeenCalledWith('USD');
    });

    it('honours an explicit currency over the user default', async () => {
      pricing.getRate.mockResolvedValue({ rate: D(2), id: 'fx2' });
      await service.create('u1', dto({ currency: 'EUR' }));
      expect(pricing.assertSupported).toHaveBeenCalledWith('EUR');
      // totalBase = total / rate = 20 / 2
      expect(tx.checkoutQuote.create.mock.calls[0][0].data.totalBase.toString()).toBe('10');
    });

    it('masks sensitive input values in the presented quote', async () => {
      const res = await service.create('u1', dto());
      const inputs = res.items![0].inputs!;
      expect(inputs.find((i: any) => i.fieldKey === 'pin')!.value).toBe('••••');
      expect(inputs.find((i: any) => i.fieldKey === 'player')!.value).toBe('ABC');
    });

    it('applies a PERCENT coupon discount', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1', code: 'SAVE10', isActive: true, startsAt: null, expiresAt: null,
        maxUses: null, usedCount: 0, maxUsesPerUser: null, minOrderTotal: null,
        discountType: 'PERCENT', discountValue: D(10), maxDiscount: null, currency: null,
      });

      await service.create('u1', dto({ couponCode: 'save10' }));

      const data = tx.checkoutQuote.create.mock.calls[0][0].data;
      expect(data.discount.toString()).toBe('2'); // 20 * 10%
      expect(data.total.toString()).toBe('18');
      expect(data.couponId).toBe('c1');
      expect(prisma.coupon.findUnique).toHaveBeenCalledWith({ where: { code: 'SAVE10' } });
    });

    it('caps a PERCENT discount at the coupon maxDiscount', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1', isActive: true, startsAt: null, expiresAt: null,
        maxUses: null, usedCount: 0, maxUsesPerUser: null, minOrderTotal: null,
        discountType: 'PERCENT', discountValue: D(50), maxDiscount: D(3), currency: null,
      });

      await service.create('u1', dto({ couponCode: 'HALF' }));
      // 20 * 50% = 10, capped to 3
      expect(tx.checkoutQuote.create.mock.calls[0][0].data.discount.toString()).toBe('3');
    });

    it('applies a FIXED coupon converted from the base currency', async () => {
      pricing.convert.mockResolvedValue({ amount: D(5) });
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1', isActive: true, startsAt: null, expiresAt: null,
        maxUses: null, usedCount: 0, maxUsesPerUser: null, minOrderTotal: null,
        discountType: 'FIXED', discountValue: D(5), maxDiscount: null, currency: null,
      });

      await service.create('u1', dto({ currency: 'EUR', couponCode: 'FIVE' }));
      // convertFrom routes base -> EUR through pricing.convert
      expect(pricing.convert).toHaveBeenCalled();
      expect(tx.checkoutQuote.create.mock.calls[0][0].data.discount.toString()).toBe('5');
    });

    it('never lets a discount exceed the subtotal', async () => {
      prisma.coupon.findUnique.mockResolvedValue({
        id: 'c1', isActive: true, startsAt: null, expiresAt: null,
        maxUses: null, usedCount: 0, maxUsesPerUser: null, minOrderTotal: null,
        discountType: 'FIXED', discountValue: D(999), maxDiscount: null, currency: null,
      });
      pricing.convert.mockResolvedValue({ amount: D(999) });

      await service.create('u1', dto({ currency: 'EUR', couponCode: 'BIG' }));
      expect(tx.checkoutQuote.create.mock.calls[0][0].data.discount.toString()).toBe('20');
    });

    it('prefers the live provider cost over the catalog cost', async () => {
      prisma.product.findFirst.mockResolvedValue(
        makeProduct({
          delivery: DeliveryMode.AUTO_PROVIDER,
          providers: [{ providerId: 'prov1', providerCost: D(7) }],
        }),
      );

      await service.create('u1', dto());
      const data = tx.checkoutQuote.create.mock.calls[0][0].data;
      // totalCostBase = providerCost 7 * qty 2
      expect(data.totalCostBase.toString()).toBe('14');
      expect(data.items.create[0].plannedProviderId).toBe('prov1');
    });

    it('rejects an unavailable product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.create('u1', dto())).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a quantity above maxPerOrder', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ maxPerOrder: 1 }));
      await expect(service.create('u1', dto())).rejects.toThrow(/maximum 1 per order/);
    });
  });

  describe('assertAvailable (via create)', () => {
    it('rejects when CODE_POOL stock is insufficient', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ delivery: DeliveryMode.CODE_POOL }));
      prisma.productCode.count.mockResolvedValue(1); // need 2
      await expect(service.create('u1', dto())).rejects.toThrow(/Not enough stock/);
    });

    it('passes when CODE_POOL stock is sufficient', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ delivery: DeliveryMode.CODE_POOL }));
      prisma.productCode.count.mockResolvedValue(5);
      await expect(service.create('u1', dto())).resolves.toBeDefined();
    });

    it('rejects when no healthy AUTO_PROVIDER exists', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ delivery: DeliveryMode.AUTO_PROVIDER }));
      prisma.productProvider.count.mockResolvedValue(0);
      await expect(service.create('u1', dto())).rejects.toThrow(/temporarily unavailable/);
    });

    it('rejects a MANUAL product with a tracked stockQty below demand', async () => {
      prisma.product.findFirst.mockResolvedValue(makeProduct({ delivery: DeliveryMode.MANUAL, stockQty: 1 }));
      await expect(service.create('u1', dto())).rejects.toThrow(/Not enough stock/);
    });
  });

  describe('validateInputs (via create)', () => {
    const withGame = (schema: any) =>
      makeProduct({ game: { inputSchema: schema } });

    it('encrypts sensitive fields and stores plain ones', async () => {
      prisma.product.findFirst.mockResolvedValue(
        withGame([
          { key: 'player', labelEn: 'Player', required: true },
          { key: 'pin', labelEn: 'PIN', required: false, sensitive: true },
        ]),
      );

      await service.create('u1', dto({
        items: [{ productId: 'p1', quantity: 1, inputs: [
          { key: 'player', value: 'PLAYER1' },
          { key: 'pin', value: '9999' },
        ] }],
      }));

      const created = tx.checkoutQuote.create.mock.calls[0][0].data.items.create[0].inputs.create;
      expect(crypto.encrypt).toHaveBeenCalledWith('9999');
      expect(created.find((i: any) => i.fieldKey === 'pin').value).toBe('enc:9999');
      expect(created.find((i: any) => i.fieldKey === 'player').value).toBe('PLAYER1');
    });

    it('rejects a missing required field', async () => {
      prisma.product.findFirst.mockResolvedValue(
        withGame([{ key: 'player', labelEn: 'Player', required: true }]),
      );
      await expect(
        service.create('u1', dto({ items: [{ productId: 'p1', quantity: 1, inputs: [] }] })),
      ).rejects.toThrow(/Missing required field: Player/);
    });

    it('rejects a value that fails the field regex', async () => {
      prisma.product.findFirst.mockResolvedValue(
        withGame([{ key: 'player', labelEn: 'Player', required: true, regex: '^[0-9]+$' }]),
      );
      await expect(
        service.create('u1', dto({ items: [{ productId: 'p1', quantity: 1, inputs: [{ key: 'player', value: 'abc' }] }] })),
      ).rejects.toThrow(/Invalid format for Player/);
    });
  });

  describe('resolveCoupon (via create)', () => {
    const baseCoupon = (over: Partial<any> = {}) => ({
      id: 'c1', isActive: true, startsAt: null, expiresAt: null,
      maxUses: null, usedCount: 0, maxUsesPerUser: null, minOrderTotal: null,
      discountType: 'PERCENT', discountValue: D(0), maxDiscount: null, currency: null,
      ...over,
    });

    it('rejects an unknown or inactive coupon', async () => {
      prisma.coupon.findUnique.mockResolvedValue(null);
      await expect(service.create('u1', dto({ couponCode: 'NOPE' }))).rejects.toThrow(/Invalid coupon/);

      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ isActive: false }));
      await expect(service.create('u1', dto({ couponCode: 'OFF' }))).rejects.toThrow(/Invalid coupon/);
    });

    it('rejects a coupon that has not started yet', async () => {
      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ startsAt: new Date(Date.now() + 60_000) }));
      await expect(service.create('u1', dto({ couponCode: 'SOON' }))).rejects.toThrow(/not active yet/);
    });

    it('rejects an expired coupon', async () => {
      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ expiresAt: new Date(Date.now() - 60_000) }));
      await expect(service.create('u1', dto({ couponCode: 'OLD' }))).rejects.toThrow(/has expired/);
    });

    it('rejects a fully redeemed coupon', async () => {
      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ maxUses: 5, usedCount: 5 }));
      await expect(service.create('u1', dto({ couponCode: 'GONE' }))).rejects.toThrow(/fully redeemed/);
    });

    it('rejects when the per-user limit is reached', async () => {
      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ maxUsesPerUser: 1 }));
      prisma.order.count.mockResolvedValue(1);
      await expect(service.create('u1', dto({ couponCode: 'ONCE' }))).rejects.toThrow(/already used this coupon/);
    });

    it('rejects when subtotal is below the minimum order total', async () => {
      prisma.coupon.findUnique.mockResolvedValue(baseCoupon({ minOrderTotal: D(100) }));
      pricing.convert.mockResolvedValue({ amount: D(100) }); // threshold 100 > subtotal 20
      await expect(service.create('u1', dto({ couponCode: 'MIN' }))).rejects.toThrow(/Minimum order total/);
    });
  });

  describe('findOne', () => {
    it('throws when the quote is missing', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(null);
      await expect(service.findOne('q1', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects access to another account’s quote', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuoteRow({ userId: 'other' }));
      await expect(service.findOne('q1', 'u1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lazily expires an active-but-stale quote on read', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(
        makeQuoteRow({ status: QuoteStatus.ACTIVE, expiresAt: new Date(Date.now() - 1000) }),
      );
      const res = await service.findOne('q1', 'u1');
      expect(prisma.checkoutQuote.update).toHaveBeenCalledWith({
        where: { id: 'q1' }, data: { status: QuoteStatus.EXPIRED },
      });
      expect(res.status).toBe(QuoteStatus.EXPIRED);
      expect(res.isExpired).toBe(true);
    });

    it('returns a live quote without touching it', async () => {
      prisma.checkoutQuote.findUnique.mockResolvedValue(makeQuoteRow());
      const res = await service.findOne('q1', 'u1');
      expect(prisma.checkoutQuote.update).not.toHaveBeenCalled();
      expect(res.isExpired).toBe(false);
      expect(res.secondsRemaining).toBeGreaterThan(0);
    });
  });

  describe('expireStale', () => {
    it('returns 0 without a write when nothing is stale', async () => {
      prisma.checkoutQuote.findMany.mockResolvedValue([]);
      const count = await service.expireStale();
      expect(count).toBe(0);
      expect(prisma.checkoutQuote.updateMany).not.toHaveBeenCalled();
    });

    it('bulk-expires the stale batch and returns the updated count', async () => {
      prisma.checkoutQuote.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      prisma.checkoutQuote.updateMany.mockResolvedValue({ count: 2 });
      const count = await service.expireStale(10);
      expect(prisma.checkoutQuote.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['a', 'b'] }, status: QuoteStatus.ACTIVE },
        data: { status: QuoteStatus.EXPIRED },
      });
      expect(count).toBe(2);
    });
  });
});
