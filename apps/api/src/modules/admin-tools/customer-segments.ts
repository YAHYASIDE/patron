import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Customer segments for the owner's dashboard. Derived, never stored: a
 * customer moves between them on their own as time passes and orders come in.
 *
 *   new      جديد   account younger than 30 days
 *   active   نشط    a paid order in the last 30 days
 *   vip      مميز   spent at least the VIP amount, or that many paid orders (setting)
 *   dormant  خامل   account older than 90 days and no paid order in the last 90
 *
 * A customer can be in more than one (a new customer who already ordered is new
 * and active). "Paid order" means the same as on the customers list: paid,
 * being delivered, or done.
 */
export const SEGMENTS = ['new', 'active', 'vip', 'dormant'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const SEGMENT_SETTINGS_KEY = 'customers.segments';
export interface SegmentSettings {
  /** Base currency; 0 = the spend rule is off. */
  vipSpendBase: number;
  /** 0 = the count rule is off. */
  vipOrders: number;
}
export const DEFAULT_SEGMENT_SETTINGS: SegmentSettings = { vipSpendBase: 500, vipOrders: 10 };

const SOLD = ['PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED'] as const;
const DAY = 86_400_000;
const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

type Db = Pick<PrismaClient, 'systemSetting' | '$queryRaw'>;

export function parseSegmentSettings(value: Prisma.JsonValue | undefined): SegmentSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    vipSpendBase: num(v.vipSpendBase, DEFAULT_SEGMENT_SETTINGS.vipSpendBase),
    vipOrders: num(v.vipOrders, DEFAULT_SEGMENT_SETTINGS.vipOrders),
  };
}

export async function readSegmentSettings(db: Db): Promise<SegmentSettings> {
  const row = await db.systemSetting.findUnique({ where: { key: SEGMENT_SETTINGS_KEY } });
  return parseSegmentSettings(row?.value);
}

export function isVip(spentBase: Prisma.Decimal.Value, paidOrders: number, s: SegmentSettings): boolean {
  const spent = new Prisma.Decimal(spentBase);
  return (s.vipSpendBase > 0 && spent.gte(s.vipSpendBase)) || (s.vipOrders > 0 && paidOrders >= s.vipOrders);
}

/** The segments one customer is in, from what the customers list already knows. */
export function segmentsOf(
  c: { createdAt: Date; lastOrderAt: Date | null; paidOrders: number; totalSpentBase: Prisma.Decimal.Value },
  s: SegmentSettings,
  now = new Date(),
): Segment[] {
  const out: Segment[] = [];
  if (c.createdAt > daysAgo(now, 30)) out.push('new');
  if (c.lastOrderAt && c.lastOrderAt > daysAgo(now, 30)) out.push('active');
  if (isVip(c.totalSpentBase, c.paidOrders, s)) out.push('vip');
  if (c.createdAt <= daysAgo(now, 90) && (!c.lastOrderAt || c.lastOrderAt <= daysAgo(now, 90))) out.push('dormant');
  return out;
}

/** The users filter for one segment, matching `segmentsOf` exactly. */
export async function segmentWhere(db: Db, segment: Segment, s: SegmentSettings, now = new Date()): Promise<Prisma.UserWhereInput> {
  const sold = { status: { in: [...SOLD] } };
  switch (segment) {
    case 'new':
      return { createdAt: { gt: daysAgo(now, 30) } };
    case 'active':
      return { orders: { some: { ...sold, createdAt: { gt: daysAgo(now, 30) } } } };
    case 'dormant':
      return { createdAt: { lte: daysAgo(now, 90) }, orders: { none: { ...sold, createdAt: { gt: daysAgo(now, 90) } } } };
    case 'vip': {
      if (s.vipSpendBase <= 0 && s.vipOrders <= 0) return { id: { in: [] } };
      // a sum per customer cannot be expressed as a Prisma filter; one grouped query instead
      const rows = await db.$queryRaw<{ userId: string }[]>`
        SELECT "userId" FROM "orders"
        WHERE "status" IN ('PAID', 'PROCESSING', 'PARTIALLY_COMPLETED', 'COMPLETED')
        GROUP BY "userId"
        HAVING (${s.vipSpendBase}::numeric > 0 AND SUM("totalBase") >= ${s.vipSpendBase}::numeric)
            OR (${s.vipOrders}::int > 0 AND COUNT(*) >= ${s.vipOrders}::int)`;
      return { id: { in: rows.map((r) => r.userId) } };
    }
  }
}
