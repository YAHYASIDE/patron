import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CatalogToolsService } from '../../src/modules/admin-tools/catalog-tools.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('CatalogToolsService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: CatalogToolsService;

  const products = [
    { id: 'p1', sku: 'A', nameAr: 'أ', sellPrice: D('10.00'), costPrice: D(8), discountPercent: null },
    { id: 'p2', sku: 'B', nameAr: 'ب', sellPrice: D('9.99'), costPrice: D(9.5), discountPercent: null },
    { id: 'p3', sku: 'C', nameAr: 'ج', sellPrice: D(20), costPrice: D(15), discountPercent: 10 },
  ];

  beforeEach(() => {
    tx = {
      product: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn((a: any) => Promise.resolve({ id: 'copy', ...a.data })),
      },
    };
    prisma = {
      product: {
        findMany: jest.fn().mockResolvedValue(products),
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CatalogToolsService(prisma, audit);
  });

  describe('bulkPrice', () => {
    it('previews the change without writing on a dry run', async () => {
      const res = await service.bulkPrice({ percent: 10, dryRun: true, categoryId: 'cat' }, 'a');
      expect(res.applied).toBe(0);
      expect(res.items).toEqual([
        { id: 'p1', sku: 'A', nameAr: 'أ', from: '10', to: '11.00', costPrice: '8', belowCost: false },
        { id: 'p2', sku: 'B', nameAr: 'ب', from: '9.99', to: '10.99', costPrice: '9.5', belowCost: false },
        { id: 'p3', sku: 'C', nameAr: 'ج', from: '20', to: '22.00', costPrice: '15', belowCost: false },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, categoryId: 'cat' });
    });

    it('never applies a price below cost (the discount counts) and audits each change', async () => {
      // −20%: A 8.00 (= cost, kept), B 7.99 (< 9.5), C 16.00 → 14.40 paid after 10% off (< 15)
      const res = await service.bulkPrice({ percent: -20, dryRun: false, gameId: 'g', productIds: ['p1', 'p2', 'p3'] }, 'admin-1');
      expect(res.items.map((i) => [i.to, i.belowCost])).toEqual([['8.00', false], ['7.99', true], ['16.00', true]]);
      expect(res.applied).toBe(1);
      expect(tx.product.update).toHaveBeenCalledTimes(1);
      expect(tx.product.update.mock.calls[0][0]).toEqual({ where: { id: 'p1' }, data: { sellPrice: D('8.00') } });
      expect(audit.record.mock.calls[0][1]).toMatchObject({
        actorId: 'admin-1', action: 'catalog.product.bulk_price', entityId: 'p1', after: { percent: -20 },
      });
      expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, gameId: 'g', id: { in: ['p1', 'p2', 'p3'] } });
    });

    it('rounds half up to 2 decimals and skips unchanged prices', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'A', nameAr: 'أ', sellPrice: D('1.25'), costPrice: D(0), discountPercent: null },
        { id: 'p2', sku: 'B', nameAr: 'ب', sellPrice: D(0), costPrice: D(0), discountPercent: null },
      ]);
      const res = await service.bulkPrice({ percent: 2, dryRun: false }, 'a');
      expect(res.items[0].to).toBe('1.28'); // 1.275 → 1.28
      expect(res.applied).toBe(1);
      expect(tx.product.update).toHaveBeenCalledTimes(1);
    });

    it('does not open a transaction when nothing changes', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      expect(await service.bulkPrice({ percent: 5, dryRun: false }, 'a')).toEqual({ items: [], applied: 0 });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('clone', () => {
    const source = {
      id: 'p1', sku: 'GC-APPLE-US-25', type: 'GIFT_CARD', delivery: 'MANUAL', nameAr: 'آيتونز 25', nameEn: 'iTunes 25',
      description: null, imageUrl: 'https://x/a.svg', costPrice: D(24), sellPrice: D(26), discountPercent: null,
      currency: 'USD', stockQty: 7, lowStockAlert: 5, maxPerOrder: 10, isActive: true, isFeatured: true, sortOrder: 3,
      metadata: { guide: { ar: 'x' } }, etaMinutes: 10, categoryId: 'cat', gameId: null,
      prices: [{ currencyCode: 'MRU', sellPrice: D(1035), isActive: true }],
    };

    it('creates an inactive copy with a -COPY sku, the same prices and no codes', async () => {
      prisma.product.findFirst.mockResolvedValue(source);
      const copy: any = await service.clone('p1', 'admin-1');
      expect(copy).toMatchObject({
        sku: 'GC-APPLE-US-25-COPY', nameAr: 'آيتونز 25 (نسخة)', nameEn: 'iTunes 25 (copy)',
        isActive: false, isFeatured: false, stockQty: 0, categoryId: 'cat', etaMinutes: 10,
        metadata: { guide: { ar: 'x' } },
        prices: { create: [{ currencyCode: 'MRU', sellPrice: D(1035), isActive: true }] },
      });
      expect(tx.product.create.mock.calls[0][0].data).not.toHaveProperty('codes');
      expect(audit.record.mock.calls[0][1]).toMatchObject({
        action: 'catalog.product.clone', entityId: 'copy', after: { from: 'p1', fromSku: 'GC-APPLE-US-25', sku: 'GC-APPLE-US-25-COPY' },
      });
    });

    it('numbers further copies and keeps the sku within 40 characters', async () => {
      const long = 'X'.repeat(40);
      prisma.product.findFirst.mockResolvedValue({ ...source, sku: long, stockQty: null, metadata: null, prices: [] });
      prisma.product.findUnique.mockImplementation((a: any) => Promise.resolve(a.where.sku.endsWith('-COPY') ? { id: 'taken' } : null));
      const copy: any = await service.clone('p1', 'a');
      expect(copy.sku).toBe(`${'X'.repeat(34)}-COPY2`);
      expect(copy.sku).toHaveLength(40);
      expect(copy.stockQty).toBeNull();
      expect(copy.prices).toBeUndefined();
      expect(copy.metadata).toBeUndefined();
    });

    it('keeps long names within 120 characters', async () => {
      prisma.product.findFirst.mockResolvedValue({ ...source, nameAr: 'ن'.repeat(120), nameEn: 'n'.repeat(120) });
      const copy: any = await service.clone('p1', 'a');
      expect(copy.nameAr).toHaveLength(120);
      expect(copy.nameEn.endsWith(' (copy)')).toBe(true);
    });

    it('gives up after 50 copies', async () => {
      prisma.product.findFirst.mockResolvedValue(source);
      prisma.product.findUnique.mockResolvedValue({ id: 'taken' });
      await expect(service.clone('p1', 'a')).rejects.toThrow(BadRequestException);
    });

    it('404s for a missing product', async () => {
      prisma.product.findFirst.mockResolvedValue(null);
      await expect(service.clone('nope', 'a')).rejects.toThrow(NotFoundException);
    });
  });
});
