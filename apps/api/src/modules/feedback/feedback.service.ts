import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ServerErrorReport, setServerErrorSink } from '../../common/filters/server-error-sink';
import { EventKind, ReportEventDto } from './dto/feedback.dto';

const DAY_MS = 86_400_000;
const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * What the shop learns from its visitors, so the owner can see what customers
 * look for and do not find, and what breaks, without reading logs
 * (docs/api-contract-feedback.md).
 */
@Injectable()
export class FeedbackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FeedbackService.name);
  // one row per server error message a minute: a broken dependency fails every request
  private recentServerErrors = new Map<string, number>();

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    setServerErrorSink((r) => void this.recordServerError(r));
  }

  onModuleDestroy() {
    setServerErrorSink(null);
  }

  /** Only the fields each kind uses are kept, cut to size; anything else is dropped. */
  private detailFor(kind: EventKind, raw?: Record<string, unknown>): Prisma.InputJsonValue | undefined {
    if (!raw) return undefined;
    const picked: Record<string, string | undefined> =
      kind === 'brand_view'
        ? { title: str(raw.title, 100) }
        : kind === 'suggestion'
          ? { contact: str(raw.contact, 60) }
          : kind === 'client_error'
            ? { app: raw.app === 'admin' ? 'admin' : 'store', stack: str(raw.stack, 1500), ua: str(raw.ua, 200) }
            : {};
    const kept = Object.fromEntries(Object.entries(picked).filter(([, v]) => v !== undefined));
    return Object.keys(kept).length ? kept : undefined;
  }

  async record(dto: ReportEventDto, userId: string | null) {
    await this.prisma.storeEvent.create({
      data: {
        kind: dto.kind,
        value: dto.value.replace(/\s+/g, ' ').slice(0, 300),
        path: dto.path ?? null,
        detail: this.detailFor(dto.kind, dto.detail),
        userId,
      },
    });
    return { ok: true };
  }

  async recordServerError(r: ServerErrorReport, now = Date.now()) {
    const key = r.message.slice(0, 200);
    const last = this.recentServerErrors.get(key);
    if (last && now - last < 60_000) return;
    this.recentServerErrors.set(key, now);
    if (this.recentServerErrors.size > 200) this.recentServerErrors.clear();
    try {
      await this.prisma.storeEvent.create({
        data: {
          kind: 'server_error',
          value: (r.message || 'Unknown error').slice(0, 300),
          path: r.path.slice(0, 200),
          detail: { method: r.method, status: r.status, correlationId: r.correlationId },
        },
      });
    } catch (err) {
      // the database itself may be the failure; the log line is enough then
      this.logger.warn(`Could not record a server error: ${(err as Error).message}`);
    }
  }

  async opportunities(days = 30, now = new Date()) {
    const since = new Date(now.getTime() - days * DAY_MS);
    const [searchMisses, mostViewed, suggestions, abandoned] = await Promise.all([
      this.prisma.$queryRaw<Array<{ query: string; count: number; lastAt: Date }>>`
        SELECT lower(regexp_replace(trim("value"), '\\s+', ' ', 'g')) AS "query",
               count(*)::int AS "count", max("createdAt") AS "lastAt"
        FROM "store_events"
        WHERE "kind" = 'search_miss' AND "createdAt" >= ${since}
        GROUP BY 1 ORDER BY 2 DESC, 3 DESC LIMIT 30`,
      this.prisma.$queryRaw<Array<{ brandKey: string; title: string | null; views: number }>>`
        SELECT "value" AS "brandKey",
               (array_agg("detail"->>'title' ORDER BY "createdAt" DESC))[1] AS "title",
               count(*)::int AS "views"
        FROM "store_events"
        WHERE "kind" = 'brand_view' AND "createdAt" >= ${since}
        GROUP BY "value" ORDER BY 3 DESC LIMIT 20`,
      this.prisma.storeEvent.findMany({
        where: { kind: 'suggestion', createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, value: true, detail: true, createdAt: true,
          user: { select: { id: true, fullName: true, phone: true } },
        },
      }),
      // checkouts that never became an order, unless the same customer bought that product later anyway
      this.prisma.$queryRaw<
        Array<{ productId: string; sku: string; nameAr: string; checkouts: number; customers: number; lastAt: Date }>
      >`
        SELECT qi."productId", p."sku", p."nameAr",
               count(DISTINCT q."id")::int AS "checkouts",
               count(DISTINCT q."userId")::int AS "customers",
               max(q."createdAt") AS "lastAt"
        FROM "quote_items" qi
        JOIN "checkout_quotes" q ON q."id" = qi."quoteId"
        JOIN "products" p ON p."id" = qi."productId"
        WHERE q."createdAt" >= ${since}
          AND NOT EXISTS (SELECT 1 FROM "orders" o WHERE o."quoteId" = q."id")
          AND NOT EXISTS (
            SELECT 1 FROM "order_items" oi JOIN "orders" o2 ON o2."id" = oi."orderId"
            WHERE o2."userId" = q."userId" AND oi."productId" = qi."productId" AND o2."createdAt" >= q."createdAt")
        GROUP BY qi."productId", p."sku", p."nameAr"
        ORDER BY 4 DESC, 6 DESC LIMIT 20`,
    ]);
    return {
      days,
      searchMisses,
      suggestions: suggestions.map((s) => ({
        id: s.id,
        text: s.value,
        contact: str((s.detail as Record<string, unknown> | null)?.contact, 60) ?? null,
        createdAt: s.createdAt,
        user: s.user,
      })),
      abandoned,
      mostViewed,
    };
  }

  errors(days = 7, now = new Date()) {
    const since = new Date(now.getTime() - days * DAY_MS);
    return this.prisma.$queryRaw<
      Array<{
        source: string; message: string; count: number; lastAt: Date;
        lastPath: string | null; lastUa: string | null; stack: string | null;
      }>
    >`
      SELECT CASE WHEN "kind" = 'server_error' THEN 'server' ELSE coalesce("detail"->>'app', 'store') END AS "source",
             left("value", 200) AS "message",
             count(*)::int AS "count",
             max("createdAt") AS "lastAt",
             (array_agg("path" ORDER BY "createdAt" DESC))[1] AS "lastPath",
             (array_agg("detail"->>'ua' ORDER BY "createdAt" DESC))[1] AS "lastUa",
             (array_agg("detail"->>'stack' ORDER BY "createdAt" DESC))[1] AS "stack"
      FROM "store_events"
      WHERE "kind" IN ('client_error', 'server_error') AND "createdAt" >= ${since}
      GROUP BY 1, 2 ORDER BY 4 DESC LIMIT 50`;
  }
}
