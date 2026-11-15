import { DeliveryMode } from '@prisma/client';
import {
  NO_SOURCES,
  availabilityMap,
  hasDeliverySource,
  isAvailable,
  loadDeliverySources,
} from '../../src/modules/catalog/availability';

const manual = (over: Partial<any> = {}) => ({
  id: 'm1', delivery: DeliveryMode.MANUAL, stockQty: null, selfDelivery: false, ...over,
});
const sources = (over: Partial<any> = {}) => ({ ...NO_SOURCES, ...over });

describe('availability rule', () => {
  describe('MANUAL', () => {
    it('is not orderable with no code stock, no supplier link and no self-delivery', () => {
      expect(isAvailable(manual(), NO_SOURCES)).toBe(false);
      expect(hasDeliverySource(manual(), NO_SOURCES)).toBe(false);
    });

    it('is orderable from the owner\'s code stock', () => {
      expect(isAvailable(manual(), sources({ codes: 1 }))).toBe(true);
    });

    it('is orderable when linked to an active supplier, automatic delivery on or off', () => {
      expect(isAvailable(manual(), sources({ suppliers: 1 }))).toBe(true);
    });

    it('is orderable when the owner delivers it himself («أسلّمه بنفسي»)', () => {
      expect(isAvailable(manual({ selfDelivery: true }), NO_SOURCES)).toBe(true);
    });

    it('a healthy automatic route alone does not count for a MANUAL product', () => {
      expect(isAvailable(manual(), sources({ routes: 1 }))).toBe(false);
    });

    it('keeps the stockQty cap: 0 is sold out even with a source', () => {
      expect(isAvailable(manual({ selfDelivery: true, stockQty: 0 }), NO_SOURCES)).toBe(false);
      expect(isAvailable(manual({ stockQty: 0 }), sources({ suppliers: 1, codes: 3 }))).toBe(false);
      expect(isAvailable(manual({ selfDelivery: true, stockQty: 2 }), NO_SOURCES)).toBe(true);
      // the delivery half alone ignores the cap (checkout reports OUT_OF_STOCK for it)
      expect(hasDeliverySource(manual({ selfDelivery: true, stockQty: 0 }), NO_SOURCES)).toBe(true);
    });
  });

  it('keeps the CODE_POOL and AUTO_PROVIDER rules', () => {
    const pool = { id: 'c', delivery: DeliveryMode.CODE_POOL, stockQty: 0 };
    expect(isAvailable(pool, sources({ codes: 1 }))).toBe(true);
    expect(isAvailable(pool, sources({ suppliers: 1 }))).toBe(false);
    const auto = { id: 'a', delivery: DeliveryMode.AUTO_PROVIDER, stockQty: 0, selfDelivery: true };
    expect(isAvailable(auto, sources({ routes: 1 }))).toBe(true);
    expect(isAvailable(auto, sources({ suppliers: 1 }))).toBe(false);
  });

  it('a hidden or deleted product is never orderable', () => {
    expect(isAvailable(manual({ selfDelivery: true, isActive: false }), NO_SOURCES)).toBe(false);
    expect(isAvailable(manual({ selfDelivery: true, deletedAt: new Date() }), NO_SOURCES)).toBe(false);
  });
});

describe('loadDeliverySources / availabilityMap', () => {
  let prisma: any;
  beforeEach(() => {
    prisma = {
      productCode: { groupBy: jest.fn().mockResolvedValue([]) },
      productProvider: { groupBy: jest.fn().mockResolvedValue([]) },
    };
  });

  it('counts live code stock and active suppliers for MANUAL products, in aggregate queries', async () => {
    prisma.productCode.groupBy.mockResolvedValue([{ productId: 'codes', _count: { _all: 2 } }]);
    prisma.productProvider.groupBy.mockResolvedValue([{ productId: 'linked', _count: { _all: 1 } }]);
    const map = await availabilityMap(prisma, [
      manual({ id: 'codes' }),
      manual({ id: 'linked' }),
      manual({ id: 'self', selfDelivery: true }),
      manual({ id: 'none' }),
    ]);
    expect(Object.fromEntries(map)).toEqual({ codes: true, linked: true, self: true, none: false });

    // one code query and one supplier query; a self-delivered product needs neither
    expect(prisma.productCode.groupBy).toHaveBeenCalledTimes(1);
    const codeWhere = prisma.productCode.groupBy.mock.calls[0][0].where;
    expect(codeWhere.productId).toEqual({ in: ['codes', 'linked', 'none'] });
    expect(codeWhere.isUsed).toBe(false);
    // only codes deliverFromStock can still hand out
    expect(codeWhere.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
    expect(prisma.productProvider.groupBy).toHaveBeenCalledTimes(1);
    // an inactive supplier does not count; the link's automatic-delivery switch does not matter
    expect(prisma.productProvider.groupBy.mock.calls[0][0].where).toEqual({
      productId: { in: ['codes', 'linked', 'none'] }, provider: { isActive: true },
    });
  });

  it('a link to an inactive supplier leaves the product greyed out', async () => {
    // the database filters inactive suppliers out, so the product gets no count
    prisma.productProvider.groupBy.mockResolvedValue([]);
    expect((await availabilityMap(prisma, [manual()])).get('m1')).toBe(false);
  });

  it('makes no query when nothing needs one', async () => {
    const res = await loadDeliverySources(prisma, [manual({ selfDelivery: true })]);
    expect(res.get('m1')).toEqual(NO_SOURCES);
    expect((await availabilityMap(prisma, [])).size).toBe(0);
    expect(prisma.productCode.groupBy).not.toHaveBeenCalled();
    expect(prisma.productProvider.groupBy).not.toHaveBeenCalled();
  });
});
