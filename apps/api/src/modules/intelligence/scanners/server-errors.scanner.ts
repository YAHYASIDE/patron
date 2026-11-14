import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { errorFingerprint } from '../../staff-notifications/staff-events.service';
import { DiscoveryInput, Scanner } from '../intelligence.types';

/** The window the dashboard's errors page shows (FeedbackService.errors). */
export const ERROR_WINDOW_DAYS = 7;
/** "Repeated": seen at least this many times in the window. */
export const MIN_REPEATS = 3;
const MAX_ROWS = 5000;

export interface ServerErrorRow {
  value: string;
  path: string | null;
  createdAt: Date;
}
/** An open `system.error` staff notice: its entityId is the same errorFingerprint, data.count how often it came. */
export interface ErrorNotice {
  entityId: string | null;
  body: string;
  data: Prisma.JsonValue;
  updatedAt: Date;
}

const blankPath = (path: string) =>
  path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\?.*$/, '')
    .slice(0, 200);

const noticeCount = (data: Prisma.JsonValue) =>
  data && typeof data === 'object' && !Array.isArray(data) && 'count' in data ? Number(data.count) || 1 : 1;

/**
 * Server errors that keep coming back (contract: In-app scanners §4), from the
 * feedback module's stored `server_error` events and the open `system.error`
 * notices (which outlive the events' retention). Grouped with the same
 * fingerprint the notices use, so one problem is one discovery.
 */
export function serverErrorFindings(rows: ServerErrorRow[], notices: ErrorNotice[]): DiscoveryInput[] {
  const groups = new Map<string, { message: string; path: string; count: number; lastAt: Date; fromNotice: boolean }>();
  for (const r of rows) {
    const path = r.path ?? '';
    const fp = errorFingerprint(r.value, path);
    const g = groups.get(fp);
    if (g) {
      g.count += 1;
      if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
    } else {
      groups.set(fp, { message: r.value, path, count: 1, lastAt: r.createdAt, fromNotice: false });
    }
  }
  for (const n of notices) {
    if (!n.entityId) continue;
    const count = noticeCount(n.data);
    const g = groups.get(n.entityId);
    if (g) {
      g.count = Math.max(g.count, count);
    } else {
      // body: "<METHOD> <path> — <message>"
      const m = /^\S+\s+(\S+)\s+—\s+([\s\S]*)$/.exec(n.body);
      groups.set(n.entityId, { message: m?.[2] ?? n.body, path: m?.[1] ?? '', count, lastAt: n.updatedAt, fromNotice: true });
    }
  }

  return [...groups]
    .filter(([, g]) => g.count >= MIN_REPEATS)
    .map(([fp, g]): DiscoveryInput => {
      const money = /^Duplicate payment/i.test(g.message);
      return {
        fingerprint: `server-error:${fp}`,
        kind: 'bug',
        title: `خطأ خادم متكرر: ${g.message.slice(0, 120)}`,
        description: `الخطأ «${g.message.slice(0, 300)}» على ${blankPath(g.path) || '—'} تكرر ${g.count} مرة خلال ${ERROR_WINDOW_DAYS} أيام.`,
        evidence: [
          {
            type: 'log',
            ref: g.fromNotice ? 'staff_notifications:system.error' : 'store_events:server_error',
            detail: `${g.count} مرة، آخرها ${g.lastAt.toISOString()}`,
          },
          ...(g.path ? [{ type: 'url' as const, ref: blankPath(g.path) }] : []),
        ],
        confidence: 90,
        verified: true,
        severity: money || g.count >= 50 ? 'HIGH' : g.count >= 10 ? 'MEDIUM' : 'LOW',
        impact: money ? 'دفعة مكررة: زبون دفع مرتين ويحتاج إلى استرجاع.' : 'طلبات تفشل للزبائن أو للوحة التحكم في هذا المسار.',
        proposal: 'افتح صفحة الأخطاء في اللوحة، تتبّع رقم correlationId في السجلات، وأصلح السبب مع اختبار يمنع عودته.',
      };
    });
}

@Injectable()
export class ServerErrorsScanner implements Scanner {
  readonly name = 'server-errors' as const;

  constructor(private prisma: PrismaService) {}

  async scan(now: Date): Promise<DiscoveryInput[]> {
    const since = new Date(now.getTime() - ERROR_WINDOW_DAYS * 86_400_000);
    const [rows, notices] = await Promise.all([
      this.prisma.storeEvent.findMany({
        where: { kind: 'server_error', createdAt: { gte: since } },
        select: { value: true, path: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.staffNotification.findMany({
        where: { type: 'system.error', resolvedAt: null, updatedAt: { gte: since } },
        select: { entityId: true, body: true, data: true, updatedAt: true },
        take: 500,
      }),
    ]);
    return serverErrorFindings(rows, notices);
  }
}
