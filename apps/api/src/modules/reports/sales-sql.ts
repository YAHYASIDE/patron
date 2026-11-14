import { Prisma } from '@prisma/client';

/**
 * How every money figure counts a sale, shared by the reports page and the
 * dashboard home so the two always agree. SQL fragments over an `orders o`.
 */

/** A paid order counts on the day it was paid; failed, refunded and cancelled orders are not sales. */
export const PAID_ORDER = Prisma.sql`o."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED', 'FAILED', 'REFUNDED')`;

/** Items whose frozen cost counts: everything not failed, refunded or cancelled. */
export const COUNTED_ITEM = Prisma.sql`i."status" NOT IN ('FAILED', 'REFUNDED', 'CANCELLED')`;

/**
 * Per order: what was refunded (processed refunds, at the order's frozen rate)
 * and what is owed (failed or cancelled lines, with the order's discount, in
 * the base currency). Join these before using NET_REVENUE.
 */
export const NET_JOINS = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT SUM(r."amountBase") AS refunded
    FROM "refunds" r
    WHERE r."orderId" = o."id" AND r."status" = 'PROCESSED'
  ) rf ON TRUE
  LEFT JOIN LATERAL (
    SELECT SUM(i2."lineTotal") / o."fxRate" * (o."total" / NULLIF(o."subtotal", 0)) AS owed
    FROM "order_items" i2
    WHERE i2."orderId" = o."id" AND i2."status" IN ('FAILED', 'CANCELLED')
  ) fl ON TRUE`;

/**
 * What a paid order really brought in: what the customer paid, less what we
 * gave back or still owe them. A refund for a failed line is the same money
 * as that line, so the larger of the two is taken, never both.
 */
export const NET_REVENUE = Prisma.sql`(o."totalBase" - GREATEST(COALESCE(rf.refunded, 0), COALESCE(fl.owed, 0)))`;
