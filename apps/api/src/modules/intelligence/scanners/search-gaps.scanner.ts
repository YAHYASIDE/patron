import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { scrubText } from '../scrubber';
import { DiscoveryInput, Scanner } from '../intelligence.types';

/** The window the dashboard's opportunities page uses (FeedbackService.opportunities). */
export const SEARCH_WINDOW_DAYS = 30;
/** Searched at least this often without a result before it is worth the owner's time. */
export const MIN_SEARCHES = 3;
const TOP = 20;

export interface SearchMiss {
  query: string;
  count: number;
  lastAt: Date;
}

/**
 * Store searches that found nothing (contract: In-app scanners §5) become
 * opportunities: something customers ask for that the shop does not list. A
 * query that the scrubber would change (a phone number, an email…) is personal
 * data typed into the search box, not a product, and is skipped.
 */
export function searchGapFindings(misses: SearchMiss[]): DiscoveryInput[] {
  return misses
    .filter((m) => m.count >= MIN_SEARCHES && m.query.trim().length >= 2 && scrubText(m.query) === m.query)
    .map((m): DiscoveryInput => ({
      fingerprint: `search-gap:${createHash('sha256').update(m.query).digest('hex').slice(0, 16)}`,
      kind: 'opportunity',
      title: `بحث بلا نتائج: «${m.query.slice(0, 80)}»`,
      description: `بحث الزبائن عن «${m.query.slice(0, 200)}» ${m.count} مرة خلال ${SEARCH_WINDOW_DAYS} يومًا ولم يجدوا شيئًا (آخر مرة ${m.lastAt.toISOString().slice(0, 10)}).`,
      evidence: [{ type: 'metric', ref: 'store_events:search_miss', detail: `${m.count} بحث` }],
      confidence: Math.min(90, 40 + m.count * 2),
      verified: true,
      severity: m.count >= 20 ? 'MEDIUM' : 'LOW',
      impact: 'زبائن يريدون منتجًا لا نعرضه، أو يكتبون اسمه بطريقة لا يعرفها البحث.',
      proposal: 'أضف المنتج إن كان متاحًا من مورّد موثوق، أو أضف الاسم كمرادف لمنتج موجود.',
    }));
}

@Injectable()
export class SearchGapsScanner implements Scanner {
  readonly name = 'search-gaps' as const;

  constructor(private prisma: PrismaService) {}

  async scan(now: Date): Promise<DiscoveryInput[]> {
    const since = new Date(now.getTime() - SEARCH_WINDOW_DAYS * 86_400_000);
    // the same grouping as FeedbackService.opportunities().searchMisses
    const misses = await this.prisma.$queryRaw<SearchMiss[]>`
      SELECT lower(regexp_replace(trim("value"), '\\s+', ' ', 'g')) AS "query",
             count(*)::int AS "count", max("createdAt") AS "lastAt"
      FROM "store_events"
      WHERE "kind" = 'search_miss' AND "createdAt" >= ${since}
      GROUP BY 1 HAVING count(*) >= ${MIN_SEARCHES}
      ORDER BY 2 DESC, 3 DESC LIMIT ${TOP}`;
    return searchGapFindings(misses);
  }
}
