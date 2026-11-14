import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import { IntelligenceService, tabWhere } from '../../src/modules/intelligence/intelligence.service';
import { IntelligenceController } from '../../src/modules/intelligence/intelligence.controller';
import { ACTION_FROM, ACTION_STATUS, DECISION_ACTIONS, SCANNER_NAMES } from '../../src/modules/intelligence/intelligence.types';
import { decodeCursor, encodeCursor } from '../../src/common/dto/cursor.dto';
import { MarketsService } from '../../src/modules/markets/markets.service';
import { IntelligenceProcessor, INTEL_SCAN_JOB } from '../../src/modules/queues/processors/intelligence.processor';

const NOW = new Date('2026-10-20T10:00:00.000Z');
const ID = randomUUID();
const ACTOR = randomUUID();
const discovery = (over: Record<string, unknown> = {}) => ({
  id: ID, title: 'عنوان', impact: 'i', proposal: 'p', severity: 'MEDIUM', status: 'NEW', deferredUntil: null,
  createdAt: NOW, ...over,
});

describe('IntelligenceService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let store: any;
  let markets: any;
  let scanners: any;
  let service: IntelligenceService;

  beforeEach(() => {
    tx = {
      discovery: {
        findUnique: jest.fn().mockResolvedValue(discovery()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(discovery()),
      },
      discoveryDecision: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      discovery: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      marketPaymentMethod: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue([]) },
      productMarketRule: { count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue([]) },
      discoveryDecision: { findMany: jest.fn().mockResolvedValue([]) },
      agentRun: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((a: any) => Promise.resolve({ id: randomUUID(), ...a.data })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: ' Owner ' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined), recordAsync: jest.fn().mockResolvedValue(undefined) };
    store = {
      upsert: jest.fn((d: any) => Promise.resolve({ created: d.fingerprint.startsWith('new'), discovery: { id: randomUUID() } })),
      resolveCritical: jest.fn().mockResolvedValue(undefined),
      raiseCritical: jest.fn().mockResolvedValue(undefined),
    };
    markets = {
      upsertMethods: jest.fn().mockResolvedValue({ created: 1, updated: 0 }),
      upsertRules: jest.fn().mockResolvedValue({ created: 0, updated: 2 }),
    };
    scanners = { runAll: jest.fn().mockResolvedValue({ run: { id: 'r1', status: 'SUCCEEDED' }, created: 1, updated: 0 }) };
    service = new IntelligenceService(prisma, audit, store, markets as unknown as MarketsService, scanners);
  });

  describe('tabs', () => {
    it('match the contract', () => {
      expect(tabWhere('new')).toEqual({ status: 'NEW' });
      expect(tabWhere('critical')).toEqual({ severity: { in: ['CRITICAL', 'HIGH'] }, status: { notIn: ['DONE', 'REJECTED'] } });
      expect(tabWhere('opportunities')).toEqual({ kind: 'opportunity' });
      expect(tabWhere('pending')).toEqual({ status: 'PENDING_REVIEW' });
      expect(tabWhere('done')).toEqual({ status: 'DONE' });
      expect(tabWhere('deferred')).toEqual({ status: 'DEFERRED' });
      expect(tabWhere('all')).toEqual({});
      expect(tabWhere(undefined)).toEqual({});
    });
  });

  describe('list', () => {
    it('filters, searches and pages by cursor', async () => {
      const rows = [discovery({ id: 'a' }), discovery({ id: 'b' }), discovery({ id: 'c' })];
      prisma.discovery.findMany.mockResolvedValue(rows);
      const res = await service.list({ tab: 'critical', kind: 'payment', severity: 'HIGH', q: 'bank', limit: 2 });
      expect(res.data.map((d: any) => d.id)).toEqual(['a', 'b']);
      expect(decodeCursor(res.nextCursor!)).toEqual({ createdAt: NOW, id: 'b' });
      const args = prisma.discovery.findMany.mock.calls[0][0];
      expect(args.take).toBe(3);
      expect(args.where.AND).toEqual(expect.arrayContaining([
        tabWhere('critical'), { kind: 'payment' }, { severity: 'HIGH' },
        expect.objectContaining({ OR: expect.arrayContaining([{ title: { contains: 'bank', mode: 'insensitive' } }]) }),
      ]));
    });

    it('the last page has no cursor; a cursor narrows the next query', async () => {
      prisma.discovery.findMany.mockResolvedValue([discovery()]);
      const res = await service.list({ cursor: encodeCursor(NOW, ID) });
      expect(res.nextCursor).toBeNull();
      expect(prisma.discovery.findMany.mock.calls[0][0].take).toBe(31);
      expect(JSON.stringify(prisma.discovery.findMany.mock.calls[0][0].where)).toContain(ID);
    });
  });

  it('detail includes the decisions, and 404s on an unknown id', async () => {
    prisma.discovery.findUnique.mockResolvedValueOnce({ ...discovery(), decisions: [] });
    await expect(service.detail(ID)).resolves.toMatchObject({ decisions: [] });
    prisma.discovery.findUnique.mockResolvedValueOnce(null);
    await expect(service.detail(ID)).rejects.toMatchObject({ response: expect.objectContaining({ error: 'DISCOVERY_NOT_FOUND' }) });
  });

  describe('decide', () => {
    it.each(DECISION_ACTIONS.map((a) => [a, ACTION_STATUS[a], ACTION_FROM[a][0]] as const))(
      '%s moves %s → %s, logs the decision and audits it',
      async (action, to, from) => {
        tx.discovery.findUnique.mockResolvedValue(discovery({ status: from }));
        await service.decide(ID, { action, note: 'ok' }, ACTOR, NOW);
        expect(tx.discovery.updateMany).toHaveBeenCalledWith({
          where: { id: ID, status: from },
          data: { status: to, deferredUntil: action === 'defer' ? new Date(NOW.getTime() + 7 * 86_400_000) : null },
        });
        expect(tx.discoveryDecision.create).toHaveBeenCalledWith({
          data: { discoveryId: ID, action, note: 'ok', actorId: ACTOR, actorLabel: 'Owner' },
        });
        expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
          actorId: ACTOR, action: `intelligence.discovery.${action}`, entityType: 'Discovery', entityId: ID,
        }));
        expect(store.resolveCritical).toHaveBeenCalledTimes(to === 'DONE' || to === 'REJECTED' ? 1 : 0);
      },
    );

    it('defer honours deferDays and scrubs the note', async () => {
      await service.decide(ID, { action: 'defer', deferDays: 30, note: `call +222${String(Date.now()).slice(-8)}` }, ACTOR, NOW);
      expect(tx.discovery.updateMany.mock.calls[0][0].data.deferredUntil).toEqual(new Date(NOW.getTime() + 30 * 86_400_000));
      expect(tx.discoveryDecision.create.mock.calls[0][0].data.note).not.toMatch(/\d{5}/);
    });

    it('refuses a transition the state does not allow', async () => {
      tx.discovery.findUnique.mockResolvedValue(discovery({ status: 'DONE' }));
      await expect(service.decide(ID, { action: 'approve' }, ACTOR, NOW)).rejects.toMatchObject({
        status: 409, response: expect.objectContaining({ error: 'DISCOVERY_INVALID_TRANSITION', status: 'DONE' }),
      });
      expect(tx.discoveryDecision.create).not.toHaveBeenCalled();
    });

    it('404 on an unknown discovery; 409 when it changed meanwhile', async () => {
      tx.discovery.findUnique.mockResolvedValueOnce(null);
      await expect(service.decide(ID, { action: 'approve' }, ACTOR)).rejects.toMatchObject({ status: 404 });
      tx.discovery.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.decide(ID, { action: 'approve' }, ACTOR)).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'DISCOVERY_CHANGED' }),
      });
    });

    it('reopening a critical one raises its notice again; an actor without a name is "staff"', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      tx.discovery.findUnique.mockResolvedValue(discovery({ status: 'DONE', severity: 'CRITICAL' }));
      tx.discovery.findUniqueOrThrow.mockResolvedValue(discovery({ status: 'PENDING_REVIEW', severity: 'CRITICAL' }));
      await service.decide(ID, { action: 'reopen' }, ACTOR, NOW);
      expect(store.raiseCritical).toHaveBeenCalledTimes(1);
      expect(tx.discoveryDecision.create.mock.calls[0][0].data).toMatchObject({ actorLabel: 'staff', note: null });
    });
  });

  describe('summary', () => {
    it('counts the tabs, adds pending market items, and marks stale scanners', async () => {
      const fresh = { agent: 'scanner:catalog-readiness', startedAt: new Date(NOW.getTime() - 3_600_000), status: 'SUCCEEDED' };
      const old = { agent: 'scanner:search-gaps', startedAt: new Date(NOW.getTime() - 3 * 86_400_000), status: 'FAILED' };
      const agent = { agent: 'market-scout', startedAt: NOW, status: 'SUCCEEDED' };
      prisma.$queryRaw.mockResolvedValue([agent, fresh, old]);
      prisma.agentRun.findFirst.mockResolvedValue({ id: 'ci', testsPassed: 10 });

      const s = await service.summary(NOW);
      expect(s.counts).toEqual({ new: 1, critical: 1, opportunities: 1, pending: 1 + 2 + 3, done: 1, deferred: 1 });
      expect(s.tests.last).toEqual({ id: 'ci', testsPassed: 10 });
      expect(s.agents).toEqual([{ agent: 'market-scout', lastRun: agent }]);
      expect(s.scanners.map((x) => x.name)).toEqual([...SCANNER_NAMES]);
      expect(s.scanners.find((x) => x.name === 'catalog-readiness')).toMatchObject({ stale: false, lastStatus: 'SUCCEEDED' });
      expect(s.scanners.find((x) => x.name === 'search-gaps')).toMatchObject({ stale: true });
      expect(s.scanners.find((x) => x.name === 'server-errors')).toMatchObject({ stale: true, lastRunAt: null });
    });
  });

  it('decision log merges discovery and market decisions, newest first', async () => {
    const t = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
    const staffId = randomUUID();
    prisma.discoveryDecision.findMany.mockResolvedValue([
      { id: 'd1', discoveryId: ID, action: 'approve', note: null, actorId: ACTOR, actorLabel: 'Owner', createdAt: t(2), discovery: { id: ID, title: 'T' } },
    ]);
    prisma.marketPaymentMethod.findMany.mockResolvedValue([
      { id: 'm1', countryCode: 'ML', name: 'Orange Money', status: 'ACTIVE', decisionById: staffId, decisionAt: t(1), decisionNote: 'ok' },
    ]);
    prisma.productMarketRule.findMany.mockResolvedValue([
      { id: 'r1', countryCode: 'ML', scope: 'brand', ref: 'gc-apple-us', status: 'REJECTED', decisionById: null, decisionAt: t(3) },
    ]);
    prisma.user.findMany.mockResolvedValue([{ id: staffId, fullName: 'Aide' }]);
    const log = await service.decisions(10);
    expect(log.map((e) => [e.type, e.action, e.actorLabel])).toEqual([
      ['market.method', 'approve', 'Aide'],
      ['discovery', 'approve', 'Owner'],
      ['market.rule', 'reject', 'staff'],
    ]);
    expect(log[0]).toMatchObject({ subject: 'ML · Orange Money', note: 'ok', status: 'ACTIVE' });
  });

  it('decision log with no market decisions does not look users up', async () => {
    expect(await service.decisions()).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('agent runs filter by agent', async () => {
    await service.agentRuns({ agent: 'qa-tester', limit: 5 });
    expect(prisma.agentRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { agent: 'qa-tester' }, take: 5 }));
    await service.agentRuns({});
    expect(prisma.agentRun.findMany.mock.calls[1][0]).toMatchObject({ where: {}, take: 50 });
  });

  it('scan runs every scanner and audits who asked', async () => {
    await expect(service.scan(ACTOR)).resolves.toMatchObject({ created: 1 });
    expect(scanners.runAll).toHaveBeenCalledWith('manual');
    expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'intelligence.scan', actorId: ACTOR }));
  });

  describe('ingest', () => {
    const d = (fingerprint: string) => ({
      fingerprint, kind: 'bug' as const, title: 't', description: 'd', evidence: [], confidence: 50, verified: false,
      severity: 'LOW' as const, impact: 'i', proposal: 'p',
    });
    const source = { url: 'https://orange.ml', title: 'Orange Mali', accessedAt: '2026-10-19', publisher: 'Orange' };

    it('records the run, upserts discoveries and hands market research over with the agent as actor', async () => {
      const res = await service.ingest({
        agent: 'market-scout', trigger: 'manual', status: 'SUCCEEDED', summary: `done, token=${randomUUID()}`,
        commit: 'abc1234', branch: 'claude/x', tests: { passed: 5, failed: 1 },
        discoveries: [d('new:1'), d('old:2')],
        market: {
          code: 'ML',
          methods: [{ key: 'orange-money-ml', name: 'Orange Money', kind: 'mobile_money', currency: 'XOF', sources: [source], confidence: 90, verifiedBy: 'market-scout' }],
          rules: [{ scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', note: 'US', sources: [{ ...source, publisher: undefined }], confidence: 60, verifiedBy: 'market-scout' }],
        },
      }, { label: 'ingest-token', via: 'token' });

      expect(res).toMatchObject({ created: 1, updated: 1, market: { code: 'ML', methods: { created: 1, updated: 0 }, rules: { created: 0, updated: 2 } } });
      expect(store.upsert).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'new:1' }), 'market-scout');
      expect(markets.upsertMethods).toHaveBeenCalledWith('ML', [expect.objectContaining({ key: 'orange-money-ml', currency: 'XOF', sources: [source] })], { label: 'agent:market-scout' });
      expect(markets.upsertRules.mock.calls[0][1][0].sources[0]).not.toHaveProperty('publisher');
      const run = prisma.agentRun.create.mock.calls[0][0].data;
      expect(run).toMatchObject({
        agent: 'market-scout', trigger: 'manual', status: 'SUCCEEDED', discoveries: 2, testsPassed: 5, testsFailed: 1,
        commit: 'abc1234', branch: 'claude/x', finishedAt: expect.any(Date),
      });
      expect(run.summary).toContain('token=[redacted]');
      expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'intelligence.ingest', actorId: undefined }));
    });

    it('a staff ingest acts as that staff member; a running report has no finish time', async () => {
      await service.ingest({ agent: 'qa-tester', trigger: 'ci', status: 'RUNNING', market: { code: 'ML', methods: [] } }, { id: ACTOR, label: ACTOR, via: 'staff' });
      const run = prisma.agentRun.create.mock.calls[0][0].data;
      expect(run).toMatchObject({ finishedAt: null, summary: null, discoveries: 0, testsPassed: null });
      expect(markets.upsertMethods).not.toHaveBeenCalled();
      expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR }));

      await service.ingest({ agent: 'qa-tester', trigger: 'ci', status: 'SUCCEEDED', market: { code: 'ML', methods: [{ key: 'k', name: 'n', kind: 'bank', sources: [], confidence: 1, verifiedBy: 'v' }] } }, { id: ACTOR, label: ACTOR, via: 'staff' });
      expect(markets.upsertMethods.mock.calls[0][2]).toEqual({ id: ACTOR, label: 'Owner' });
    });

    it('a markets failure is recorded on the run and returned to the caller', async () => {
      markets.upsertMethods.mockRejectedValue(new NotFoundException({ error: 'MARKET_NOT_FOUND', message: 'Markets: no such country' }));
      await expect(service.ingest({
        agent: 'market-scout', trigger: 'manual', status: 'SUCCEEDED', discoveries: [d('new:1')],
        market: { code: 'ML', methods: [{ key: 'k', name: 'n', kind: 'bank', sources: [], confidence: 1, verifiedBy: 'v' }] },
      }, { label: 'ingest-token', via: 'token' })).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agentRun.create.mock.calls[0][0].data.details).toMatchObject({ created: 1, marketError: expect.stringContaining('Markets') });
    });
  });
});

describe('IntelligenceController', () => {
  it('passes each route through to the service', async () => {
    const intel: any = Object.fromEntries(
      ['summary', 'list', 'detail', 'decide', 'decisions', 'agentRuns', 'scan', 'ingest'].map((m) => [m, jest.fn().mockResolvedValue(m)]),
    );
    const c = new IntelligenceController(intel);
    await c.summary();
    await c.list({ tab: 'new' });
    await c.detail(ID);
    await c.decide(ID, { action: 'done' }, ACTOR);
    await c.decisions({ limit: 5 });
    await c.agentRuns({ agent: 'a' });
    await c.scan(ACTOR);
    await c.ingest({ agent: 'a', trigger: 'ci', status: 'SUCCEEDED' }, { headers: {}, intelActor: { label: 'ingest-token', via: 'token' } });
    await c.ingest({ agent: 'a', trigger: 'ci', status: 'SUCCEEDED' }, { headers: {} });
    expect(intel.decide).toHaveBeenCalledWith(ID, { action: 'done' }, ACTOR);
    expect(intel.decisions).toHaveBeenCalledWith(5);
    expect(intel.ingest).toHaveBeenCalledTimes(2);
  });
});

describe('IntelligenceProcessor', () => {
  it('runs every scanner on the daily job, and refuses unknown jobs', async () => {
    const scanners: any = { runAll: jest.fn().mockResolvedValue({ run: { id: 'r', status: 'SUCCEEDED' }, created: 2, updated: 3 }) };
    const p = new IntelligenceProcessor(scanners);
    await expect(p.process({ name: INTEL_SCAN_JOB } as any)).resolves.toEqual({ run: 'r', status: 'SUCCEEDED', created: 2, updated: 3 });
    expect(scanners.runAll).toHaveBeenCalledWith('schedule');
    await expect(p.process({ name: 'other' } as any)).rejects.toThrow(/Unknown/);
  });
});
