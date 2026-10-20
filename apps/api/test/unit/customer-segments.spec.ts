import { Prisma } from '@prisma/client';

import {
  DEFAULT_SEGMENT_SETTINGS, isVip, parseSegmentSettings, readSegmentSettings, segmentsOf, segmentWhere,
} from '../../src/modules/admin-tools/customer-segments';

const now = new Date('2026-10-20T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const s = { vipSpendBase: 500, vipOrders: 10 };

describe('customer segments', () => {
  it('reads the VIP thresholds, falling back to the defaults for anything odd', async () => {
    expect(parseSegmentSettings({ vipSpendBase: 200, vipOrders: 0 })).toEqual({ vipSpendBase: 200, vipOrders: 0 });
    expect(parseSegmentSettings({ vipSpendBase: -1, vipOrders: 'x' })).toEqual(DEFAULT_SEGMENT_SETTINGS);
    expect(parseSegmentSettings(null)).toEqual(DEFAULT_SEGMENT_SETTINGS);
    expect(parseSegmentSettings([1])).toEqual(DEFAULT_SEGMENT_SETTINGS);
    const db = { systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: { vipSpendBase: 50, vipOrders: 3 } }) } };
    expect(await readSegmentSettings(db as any)).toEqual({ vipSpendBase: 50, vipOrders: 3 });
  });

  it('is VIP by spend or by order count, either rule off at 0', () => {
    expect(isVip(500, 0, s)).toBe(true);
    expect(isVip(new Prisma.Decimal('499.99'), 9, s)).toBe(false);
    expect(isVip(0, 10, s)).toBe(true);
    expect(isVip(10_000, 100, { vipSpendBase: 0, vipOrders: 0 })).toBe(false);
  });

  it('puts each customer in the segments that apply', () => {
    const c = (createdDays: number, lastDays: number | null, paid = 0, spent = 0) =>
      segmentsOf({ createdAt: daysAgo(createdDays), lastOrderAt: lastDays === null ? null : daysAgo(lastDays), paidOrders: paid, totalSpentBase: spent }, s, now);
    expect(c(5, null)).toEqual(['new']);
    expect(c(5, 1)).toEqual(['new', 'active']);
    expect(c(60, 40)).toEqual([]);
    expect(c(200, 120, 12, 900)).toEqual(['vip', 'dormant']);
    expect(c(200, null)).toEqual(['dormant']);
    expect(c(200, 10, 2, 600)).toEqual(['active', 'vip']);
  });

  it('filters the users list by the same rules', async () => {
    const db = { systemSetting: { findUnique: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) };
    expect(await segmentWhere(db as any, 'new', s, now)).toEqual({ createdAt: { gt: daysAgo(30) } });
    expect(await segmentWhere(db as any, 'active', s, now)).toMatchObject({ orders: { some: { createdAt: { gt: daysAgo(30) } } } });
    expect(await segmentWhere(db as any, 'dormant', s, now)).toMatchObject({
      createdAt: { lte: daysAgo(90) }, orders: { none: { createdAt: { gt: daysAgo(90) } } },
    });
    expect(await segmentWhere(db as any, 'vip', s, now)).toEqual({ id: { in: ['u1', 'u2'] } });
    // both rules off: nobody, without a query
    db.$queryRaw.mockClear();
    expect(await segmentWhere(db as any, 'vip', { vipSpendBase: 0, vipOrders: 0 }, now)).toEqual({ id: { in: [] } });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
