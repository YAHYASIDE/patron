import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AgentRun, MarketReviewStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { cursorWhere, encodeCursor } from '../../common/dto/cursor.dto';
import { MarketsService } from '../markets/markets.service';
import { MarketMethodInput, MarketRuleInput } from '../markets/markets.types';
import { DiscoveriesStore } from './discoveries.store';
import { ScannersService } from './scanners/scanners.service';
import { scrubText } from './scrubber';
import { IngestActor } from './ingest.guard';
import {
  AgentRunsQueryDto, DiscoveriesQueryDto, DiscoveryDecisionDto, IngestDto, MarketIngestDto,
} from './dto/intelligence.dto';
import {
  ACTION_FROM, ACTION_STATUS, CLOSED, DEFAULT_DEFER_DAYS, DiscoveryInput, SCANNER_NAMES, SCANNER_STALE_MS, Tab,
  scannerAgent,
} from './intelligence.types';

const DAY_MS = 86_400_000;
const DEFAULT_PAGE = 30;
const DEFAULT_LOG = 50;

/** What each tab shows (contract: Tabs). */
export function tabWhere(tab: Tab | undefined): Prisma.DiscoveryWhereInput {
  switch (tab) {
    case 'new': return { status: 'NEW' };
    case 'critical': return { severity: { in: ['CRITICAL', 'HIGH'] }, status: { notIn: [...CLOSED] } };
    case 'opportunities': return { kind: 'opportunity' };
    case 'pending': return { status: 'PENDING_REVIEW' };
    case 'done': return { status: 'DONE' };
    case 'deferred': return { status: 'DEFERRED' };
    default: return {};
  }
}

/** A market method's or rule's stored decision, in the discovery decision words. */
const MARKET_ACTION: Record<MarketReviewStatus, string> = {
  APPROVED: 'approve', ACTIVE: 'approve', REJECTED: 'reject', DEFERRED: 'defer', PENDING_REVIEW: 'reopen',
};

export interface DecisionLogEntry {
  id: string;
  type: 'discovery' | 'market.method' | 'market.rule';
  subjectId: string;
  subject: string;
  action: string;
  status?: string;
  note: string | null;
  actorId: string | null;
  actorLabel: string;
  createdAt: Date;
}

/**
 * The intelligence and development center (contract: docs/contracts/intelligence-api.md,
 * section Intelligence): what agents, CI and the in-app scanners found, and the
 * owner's decisions on it. Nothing here changes the shop itself: a decision
 * only moves a discovery through its review states.
 */
@Injectable()
export class IntelligenceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private store: DiscoveriesStore,
    private markets: MarketsService,
    private scanners: ScannersService,
  ) {}

  // ─────────────── reading ───────────────

  async summary(now = new Date()) {
    const count = (where: Prisma.DiscoveryWhereInput) => this.prisma.discovery.count({ where });
    const [fresh, critical, opportunities, pending, done, deferred, methodsPending, rulesPending, lastTests, latest] =
      await Promise.all([
        count(tabWhere('new')),
        count(tabWhere('critical')),
        count(tabWhere('opportunities')),
        count(tabWhere('pending')),
        count(tabWhere('done')),
        count(tabWhere('deferred')),
        this.prisma.marketPaymentMethod.count({ where: { status: 'PENDING_REVIEW' } }),
        this.prisma.productMarketRule.count({ where: { status: 'PENDING_REVIEW' } }),
        this.prisma.agentRun.findFirst({
          where: { OR: [{ testsPassed: { not: null } }, { testsFailed: { not: null } }] },
          orderBy: { startedAt: 'desc' },
        }),
        this.latestRuns(),
      ]);

    const byAgent = new Map(latest.map((r) => [r.agent, r]));
    return {
      counts: { new: fresh, critical, opportunities, pending: pending + methodsPending + rulesPending, done, deferred },
      pendingBreakdown: { discoveries: pending, marketMethods: methodsPending, marketRules: rulesPending },
      tests: { last: lastTests },
      agents: latest.filter((r) => !r.agent.startsWith('scanner:')).map((r) => ({ agent: r.agent, lastRun: r })),
      scanners: SCANNER_NAMES.map((name) => {
        const last = byAgent.get(scannerAgent(name));
        return {
          name,
          lastRunAt: last?.startedAt ?? null,
          lastStatus: last?.status ?? null,
          stale: !last || now.getTime() - last.startedAt.getTime() > SCANNER_STALE_MS,
        };
      }),
    };
  }

  /** The newest run of every agent: one index range per agent (agent_runs(agent, startedAt)). */
  private latestRuns() {
    return this.prisma.$queryRaw<AgentRun[]>`
      SELECT DISTINCT ON ("agent") * FROM "agent_runs" ORDER BY "agent", "startedAt" DESC LIMIT 200`;
  }

  async list(q: DiscoveriesQueryDto) {
    const limit = q.limit ?? DEFAULT_PAGE;
    const and: Prisma.DiscoveryWhereInput[] = [tabWhere(q.tab)];
    if (q.kind) and.push({ kind: q.kind });
    if (q.severity) and.push({ severity: q.severity });
    if (q.q) {
      and.push({
        OR: [
          { title: { contains: q.q, mode: 'insensitive' } },
          { description: { contains: q.q, mode: 'insensitive' } },
          { fingerprint: { contains: q.q, mode: 'insensitive' } },
        ],
      });
    }
    and.push(cursorWhere(q.cursor, 'desc'));
    // newest first by creation: a stable key, so a discovery seen again mid-browse does not jump pages
    const rows = await this.prisma.discovery.findMany({
      where: { AND: and },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const data = rows.slice(0, limit);
    const last = data[data.length - 1];
    return { data, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  async detail(id: string) {
    const discovery = await this.prisma.discovery.findUnique({
      where: { id },
      include: { decisions: { orderBy: { createdAt: 'desc' } } },
    });
    if (!discovery) throw new NotFoundException({ message: 'Discovery not found', error: 'DISCOVERY_NOT_FOUND' });
    return discovery;
  }

  agentRuns(q: AgentRunsQueryDto) {
    return this.prisma.agentRun.findMany({
      where: q.agent ? { agent: q.agent } : {},
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: q.limit ?? DEFAULT_LOG,
    });
  }

  /** Discovery decisions and the market methods'/rules' last decisions, newest first. */
  async decisions(limit = DEFAULT_LOG): Promise<DecisionLogEntry[]> {
    const decided = { decisionAt: { not: null } };
    const [discoveryRows, methods, rules] = await Promise.all([
      this.prisma.discoveryDecision.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        include: { discovery: { select: { id: true, title: true } } },
      }),
      this.prisma.marketPaymentMethod.findMany({
        where: decided, orderBy: { decisionAt: 'desc' }, take: limit,
        select: { id: true, countryCode: true, name: true, status: true, decisionById: true, decisionAt: true, decisionNote: true },
      }),
      this.prisma.productMarketRule.findMany({
        where: decided, orderBy: { decisionAt: 'desc' }, take: limit,
        select: { id: true, countryCode: true, scope: true, ref: true, status: true, decisionById: true, decisionAt: true },
      }),
    ]);

    const ids = [...new Set([...methods, ...rules].map((r) => r.decisionById).filter((v): v is string => !!v))];
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = (id: string | null) => (id && users.find((u) => u.id === id)?.fullName) || 'staff';

    const entries: DecisionLogEntry[] = [
      ...discoveryRows.map((d): DecisionLogEntry => ({
        id: d.id, type: 'discovery', subjectId: d.discoveryId, subject: d.discovery.title, action: d.action,
        note: d.note, actorId: d.actorId, actorLabel: d.actorLabel, createdAt: d.createdAt,
      })),
      ...methods.map((m): DecisionLogEntry => ({
        id: m.id, type: 'market.method', subjectId: m.id, subject: `${m.countryCode} · ${m.name}`,
        action: MARKET_ACTION[m.status], status: m.status, note: m.decisionNote, actorId: m.decisionById,
        actorLabel: nameOf(m.decisionById), createdAt: m.decisionAt as Date,
      })),
      ...rules.map((r): DecisionLogEntry => ({
        id: r.id, type: 'market.rule', subjectId: r.id, subject: `${r.countryCode} · ${r.scope}:${r.ref}`,
        action: MARKET_ACTION[r.status], status: r.status, note: null, actorId: r.decisionById,
        actorLabel: nameOf(r.decisionById), createdAt: r.decisionAt as Date,
      })),
    ];
    return entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
  }

  // ─────────────── deciding ───────────────

  async decide(id: string, dto: DiscoveryDecisionDto, actorId: string, now = new Date()) {
    const actorLabel = await this.staffLabel(actorId);
    const status = ACTION_STATUS[dto.action];
    const deferredUntil = dto.action === 'defer' ? new Date(now.getTime() + (dto.deferDays ?? DEFAULT_DEFER_DAYS) * DAY_MS) : null;
    const note = dto.note ? scrubText(dto.note) : null;

    const discovery = await this.prisma.$transaction(async (tx) => {
      const before = await tx.discovery.findUnique({ where: { id } });
      if (!before) throw new NotFoundException({ message: 'Discovery not found', error: 'DISCOVERY_NOT_FOUND' });
      if (!ACTION_FROM[dto.action].includes(before.status)) {
        throw new ConflictException({
          message: `Cannot ${dto.action} a discovery that is ${before.status}`,
          error: 'DISCOVERY_INVALID_TRANSITION',
          status: before.status,
        });
      }
      // only from the state we read: two people deciding at once, the second gets a 409 instead of overwriting
      const { count } = await tx.discovery.updateMany({ where: { id, status: before.status }, data: { status, deferredUntil } });
      if (!count) throw new ConflictException({ message: 'The discovery changed meanwhile; reload it', error: 'DISCOVERY_CHANGED' });
      await tx.discoveryDecision.create({ data: { discoveryId: id, action: dto.action, note, actorId, actorLabel } });
      await this.audit.record(tx, {
        actorId,
        action: `intelligence.discovery.${dto.action}`,
        entityType: 'Discovery',
        entityId: id,
        before: { status: before.status, deferredUntil: before.deferredUntil },
        after: { status, deferredUntil, note },
      });
      if (CLOSED.includes(status)) await this.store.resolveCritical(id, tx);
      return tx.discovery.findUniqueOrThrow({ where: { id } });
    });

    // reopened and still critical: the owner hears about it again
    if (dto.action === 'reopen' && discovery.severity === 'CRITICAL') await this.store.raiseCritical(discovery);
    return discovery;
  }

  // ─────────────── writers ───────────────

  async scan(actorId: string) {
    const outcome = await this.scanners.runAll('manual');
    await this.audit.recordAsync({
      actorId, action: 'intelligence.scan', entityType: 'AgentRun', entityId: outcome.run.id,
      after: { created: outcome.created, updated: outcome.updated, status: outcome.run.status },
    });
    return outcome;
  }

  /**
   * An agent's or CI's report: one AgentRun, its discoveries upserted by
   * fingerprint, and market research handed to the markets module (which lands
   * it as PENDING_REVIEW and never changes a decision).
   */
  async ingest(dto: IngestDto, actor: IngestActor) {
    const startedAt = new Date();
    const who = actor.via === 'staff' && actor.id
      ? { id: actor.id, label: await this.staffLabel(actor.id) }
      : { label: `agent:${dto.agent}` };

    let created = 0;
    let updated = 0;
    for (const d of dto.discoveries ?? []) {
      const r = await this.store.upsert(d as DiscoveryInput, dto.agent);
      if (r.created) created++;
      else updated++;
    }

    let market: Record<string, unknown> | undefined;
    let marketError: unknown;
    if (dto.market) {
      try {
        market = await this.applyMarket(dto.market, who);
      } catch (e) {
        marketError = e;
      }
    }

    const run = await this.prisma.agentRun.create({
      data: {
        agent: dto.agent,
        trigger: dto.trigger,
        status: dto.status,
        summary: dto.summary ? scrubText(dto.summary) : null,
        discoveries: dto.discoveries?.length ?? 0,
        testsPassed: dto.tests?.passed ?? null,
        testsFailed: dto.tests?.failed ?? null,
        commit: dto.commit ?? null,
        branch: dto.branch ?? null,
        details: {
          via: actor.via, created, updated,
          ...(market && { market: market as Prisma.InputJsonValue }),
          ...(marketError !== undefined && {
            marketError: scrubText(marketError instanceof Error ? marketError.message : String(marketError)).slice(0, 300),
          }),
        },
        startedAt,
        finishedAt: dto.status === 'RUNNING' ? null : new Date(),
      },
    });
    await this.audit.recordAsync({
      actorId: who.id, action: 'intelligence.ingest', entityType: 'AgentRun', entityId: run.id,
      after: { agent: dto.agent, via: actor.via, created, updated, market: market ?? null },
    });

    if (marketError !== undefined) throw marketError;
    return { run, created, updated, ...(market && { market }) };
  }

  private async applyMarket(m: MarketIngestDto, actor: { id?: string; label: string }) {
    const out: Record<string, { created: number; updated: number }> = {};
    if (m.methods?.length) {
      const items: MarketMethodInput[] = m.methods.map((x) => ({
        key: x.key, name: x.name, kind: x.kind, confidence: x.confidence, verifiedBy: x.verifiedBy,
        sources: x.sources.map((s) => ({ url: s.url, title: s.title, accessedAt: s.accessedAt, ...(s.publisher && { publisher: s.publisher }) })),
        ...(x.provider !== undefined && { provider: x.provider }),
        ...(x.currency !== undefined && { currency: x.currency }),
        ...(x.fees !== undefined && { fees: x.fees }),
        ...(x.note !== undefined && { note: x.note }),
      }));
      out.methods = await this.markets.upsertMethods(m.code, items, actor);
    }
    if (m.rules?.length) {
      const items: MarketRuleInput[] = m.rules.map((x) => ({
        scope: x.scope, ref: x.ref, availability: x.availability, confidence: x.confidence, verifiedBy: x.verifiedBy,
        sources: x.sources.map((s) => ({ url: s.url, title: s.title, accessedAt: s.accessedAt, ...(s.publisher && { publisher: s.publisher }) })),
        ...(x.note !== undefined && { note: x.note }),
      }));
      out.rules = await this.markets.upsertRules(m.code, items, actor);
    }
    return { code: m.code, ...out };
  }

  /** How a staff member appears in the decision log: their name, never their email or phone. */
  private async staffLabel(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return user?.fullName?.trim().slice(0, 100) || 'staff';
  }
}
