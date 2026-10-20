import { Injectable, Logger } from '@nestjs/common';
import { AgentRun } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { DiscoveriesStore } from '../discoveries.store';
import { scrubText } from '../scrubber';
import { RunTrigger, SCANNERS_AGENT, Scanner, ScannerName, scannerAgent } from '../intelligence.types';
import { CatalogReadinessScanner } from './catalog-readiness.scanner';
import { PaymentsByCountryScanner } from './payments-by-country.scanner';
import { MarketStalenessScanner } from './market-staleness.scanner';
import { ServerErrorsScanner } from './server-errors.scanner';
import { SearchGapsScanner } from './search-gaps.scanner';

export interface ScannerResult {
  name: ScannerName;
  status: 'SUCCEEDED' | 'FAILED';
  found: number;
  created: number;
  updated: number;
  error?: string;
}

export interface ScanOutcome {
  run: AgentRun;
  created: number;
  updated: number;
}

/**
 * Runs the in-app scanners (the daily job and POST /admin/intelligence/scan).
 * Each scanner records its own AgentRun (`scanner:<name>`, trigger `app`) and
 * one failing never stops the others; the whole pass is one more run
 * (`scanners`) with the trigger that started it.
 */
@Injectable()
export class ScannersService {
  private readonly log = new Logger(ScannersService.name);
  readonly scanners: Scanner[];

  constructor(
    private prisma: PrismaService,
    private store: DiscoveriesStore,
    catalog: CatalogReadinessScanner,
    payments: PaymentsByCountryScanner,
    staleness: MarketStalenessScanner,
    errors: ServerErrorsScanner,
    search: SearchGapsScanner,
  ) {
    this.scanners = [catalog, payments, staleness, errors, search];
  }

  async runAll(trigger: RunTrigger, now = new Date()): Promise<ScanOutcome> {
    const startedAt = new Date();
    const woken = await this.wakeDeferred(now);
    const results: ScannerResult[] = [];
    for (const scanner of this.scanners) results.push(await this.runOne(scanner, now));

    const failed = results.filter((r) => r.status === 'FAILED');
    const created = results.reduce((s, r) => s + r.created, 0);
    const updated = results.reduce((s, r) => s + r.updated, 0);
    const found = results.reduce((s, r) => s + r.found, 0);
    const run = await this.prisma.agentRun.create({
      data: {
        agent: SCANNERS_AGENT,
        trigger,
        status: failed.length ? 'FAILED' : 'SUCCEEDED',
        summary: `${found} ملاحظة (${created} جديدة) من ${results.length} فاحصات` +
          (failed.length ? `؛ فشل: ${failed.map((r) => r.name).join('، ')}` : ''),
        discoveries: found,
        details: { scanners: results.map((r) => ({ ...r })), wokenFromDeferral: woken },
        startedAt,
        finishedAt: new Date(),
      },
    });
    return { run, created, updated };
  }

  async runOne(scanner: Scanner, now = new Date()): Promise<ScannerResult> {
    const startedAt = new Date();
    const agent = scannerAgent(scanner.name);
    let created = 0;
    let updated = 0;
    try {
      const found = await scanner.scan(now);
      for (const d of found) {
        const r = await this.store.upsert(d, agent, now);
        if (r.created) created++;
        else updated++;
      }
      await this.prisma.agentRun.create({
        data: {
          agent, trigger: 'app', status: 'SUCCEEDED',
          summary: found.length ? `${found.length} ملاحظة (${created} جديدة، ${updated} معروفة)` : 'لا شيء يحتاج انتباهًا',
          discoveries: found.length, startedAt, finishedAt: new Date(),
        },
      });
      return { name: scanner.name, status: 'SUCCEEDED', found: found.length, created, updated };
    } catch (e) {
      const error = scrubText(e instanceof Error ? e.message : String(e)).slice(0, 500);
      this.log.error(`scanner ${scanner.name} failed: ${error}`);
      try {
        await this.prisma.agentRun.create({
          data: {
            agent, trigger: 'app', status: 'FAILED', summary: `فشل الفحص: ${error}`,
            discoveries: created + updated, startedAt, finishedAt: new Date(),
          },
        });
      } catch {
        /* the database may be the failure; the log line above is enough then */
      }
      return { name: scanner.name, status: 'FAILED', found: created + updated, created, updated, error };
    }
  }

  /** A deferral that has run out goes back to review: deferring means "later", not "never". */
  private async wakeDeferred(now: Date) {
    const { count } = await this.prisma.discovery.updateMany({
      where: { status: 'DEFERRED', deferredUntil: { lte: now } },
      data: { status: 'PENDING_REVIEW', deferredUntil: null },
    });
    return count;
  }
}
