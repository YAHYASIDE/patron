import { Prisma } from '@prisma/client';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PricingService } from '../../src/modules/catalog/pricing.service';

const currency = (over: Partial<any> = {}) => ({
  code: 'USD', decimals: 2, roundingMode: 'HALF_UP', roundingStep: null, isActive: true, ...over,
});

describe('PricingService', () => {
  let prisma: any;
  let config: any;
  let pricing: PricingService;

  beforeEach(() => {
    prisma = {
      currency: { findUnique: jest.fn(), findMany: jest.fn() },
      fxRate: { findFirst: jest.fn() },
      product: { findFirst: jest.fn() },
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: 0 }) },
    };
    config = { get: jest.fn().mockReturnValue('USD') };
    pricing = new PricingService(prisma, config);
  });

  describe('getRate', () => {
    it('returns 1 for the base currency without hitting the database', async () => {
      const result = await pricing.getRate('USD');
      expect(result.rate.equals(1)).toBe(true);
      expect(prisma.fxRate.findFirst).not.toHaveBeenCalled();
    });

    it('throws rather than guessing when no rate exists', async () => {
      prisma.fxRate.findFirst.mockResolvedValue(null);
      await expect(pricing.getRate('XOF')).rejects.toThrow(NotFoundException);
    });

    it('caches so a page of products does not issue one lookup per product', async () => {
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal(604) });
      await pricing.getRate('XOF');
      await pricing.getRate('XOF');
      await pricing.getRate('XOF');
      expect(prisma.fxRate.findFirst).toHaveBeenCalledTimes(1);
    });

    it('bypasses the cache for a historical lookup', async () => {
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal(604) });
      await pricing.getRate('XOF');
      await pricing.getRate('XOF', new Date('2026-01-01'));
      expect(prisma.fxRate.findFirst).toHaveBeenCalledTimes(2);
    });
  });

  describe('priceProduct', () => {
    it('converts the base price when no override exists', async () => {
      prisma.currency.findUnique.mockResolvedValue(currency({ code: 'EUR' }));
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal('0.92') });
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', sellPrice: new Prisma.Decimal('10.00'), prices: [],
      });

      const result = await pricing.priceProduct('p1', 'EUR');
      expect(result.amount.toString()).toBe('9.2');
      expect(result.isOverride).toBe(false);
      expect(result.fxRateId).toBe('r1');
    });

    it('prefers a manual override over conversion', async () => {
      prisma.currency.findUnique.mockResolvedValue(currency({ code: 'XOF', decimals: 0 }));
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal(604) });
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1',
        sellPrice: new Prisma.Decimal('4.00'),
        prices: [{ currencyCode: 'XOF', sellPrice: new Prisma.Decimal(2500), isActive: true }],
      });

      const result = await pricing.priceProduct('p1', 'XOF');
      // 4.00 × 604 = 2416, but a human set 2500 — the human wins.
      expect(result.amount.toString()).toBe('2500');
      expect(result.isOverride).toBe(true);
      expect(result.fxRateId).toBeNull();
    });

    it('never emits fractional units for a zero-decimal currency', async () => {
      prisma.currency.findUnique.mockResolvedValue(currency({ code: 'XOF', decimals: 0 }));
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal('604.35') });
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', sellPrice: new Prisma.Decimal('4.71'), prices: [],
      });

      const result = await pricing.priceProduct('p1', 'XOF');
      expect(result.amount.decimalPlaces()).toBe(0);
    });

    it('applies the configured FX markup', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ value: 2.5 });
      prisma.currency.findUnique.mockResolvedValue(currency({ code: 'EUR' }));
      prisma.fxRate.findFirst.mockResolvedValue({ id: 'r1', rate: new Prisma.Decimal(1) });
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', sellPrice: new Prisma.Decimal('100'), prices: [],
      });

      const result = await pricing.priceProduct('p1', 'EUR');
      expect(result.amount.toString()).toBe('102.5');
    });

    it('rejects an unsupported currency instead of defaulting', async () => {
      prisma.currency.findUnique.mockResolvedValue(null);
      await expect(pricing.priceProduct('p1', 'GBP')).rejects.toThrow(BadRequestException);
    });
  });
});
