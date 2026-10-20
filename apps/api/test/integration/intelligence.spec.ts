import { randomBytes, randomUUID } from 'crypto';
import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { DiscoveryStatus } from '@prisma/client';
import request from 'supertest';

import { PrismaModule } from '../../src/common/prisma/prisma.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditModule } from '../../src/common/audit/audit.module';
import { CryptoModule } from '../../src/common/crypto/crypto.module';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { IntelligenceModule } from '../../src/modules/intelligence/intelligence.module';
import { IntelligenceService } from '../../src/modules/intelligence/intelligence.service';
import { DiscoveriesStore } from '../../src/modules/intelligence/discoveries.store';
import { ScannersService } from '../../src/modules/intelligence/scanners/scanners.service';
import { DiscoveryInput } from '../../src/modules/intelligence/intelligence.types';
import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';

const SECRET = `intel-it-${randomBytes(16).toString('hex')}`;

/** The owner's inbox without its BullMQ reminder queue (no Redis needed here). */
@Global()
@Module({ providers: [StaffNotificationsService], exports: [StaffNotificationsService] })
class StaffInboxForTest {}

const finding = (fingerprint: string, over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  fingerprint, kind: 'bug', title: `t ${fingerprint}`, description: 'd', evidence: [{ type: 'log', ref: 'x' }],
  confidence: 60, verified: false, severity: 'MEDIUM', impact: 'i', proposal: 'p', ...over,
});

/**
 * Intelligence on a real Postgres and the real guards: the unique fingerprint
 * keeps concurrent reports of one subject to one row, the tabs select what the
 * contract says, and a support user who can read cannot decide or ingest.
 */
describe('Intelligence (Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let intel: IntelligenceService;
  let store: DiscoveriesStore;
  let jwt: JwtService;
  const savedToken = process.env.INTEL_INGEST_TOKEN;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true, ignoreEnvFile: true,
          load: [() => ({
            jwt: { accessSecret: SECRET }, currency: { base: 'USD' }, crypto: { encryptionKey: randomBytes(32).toString('hex') },
          })],
        }),
        PrismaModule, CryptoModule, AuditModule, StaffInboxForTest, PassportModule, IntelligenceModule,
      ],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true, forbidNonWhitelisted: true, transform: true,
      transformOptions: { enableImplicitConversion: true }, forbidUnknownValues: true,
    }));
    await app.init();
    prisma = app.get(PrismaService);
    intel = app.get(IntelligenceService);
    store = app.get(DiscoveriesStore);
    jwt = new JwtService({ secret: SECRET });
  });

  afterAll(async () => {
    if (savedToken === undefined) delete process.env.INTEL_INGEST_TOKEN;
    else process.env.INTEL_INGEST_TOKEN = savedToken;
    await app?.close();
  });

  const http = () => request(app.getHttpServer());

  const usd = () => prisma.currency.upsert({
    where: { code: 'USD' }, update: {},
    create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
  });

  async function staff(role: string, permissions: string[]) {
    await usd();
    const r = await prisma.role.create({ data: { name: role } });
    for (const key of permissions) {
      const p = await prisma.permission.upsert({ where: { key }, update: {}, create: { key, module: 'intelligence' } });
      await prisma.rolePermission.create({ data: { roleId: r.id, permissionId: p.id } });
    }
    const user = await prisma.user.create({
      data: { email: `${role}-${randomUUID()}@test.local`, fullName: `${role} user`, passwordHash: 'x', roles: { create: { roleId: r.id } } },
    });
    return { id: user.id, auth: `Bearer ${jwt.sign({ sub: user.id, email: user.email, type: 'access' })}` };
  }

  describe('fingerprint uniqueness', () => {
    it('two parallel ingests of the same fingerprint: one row, seenCount 2', async () => {
      process.env.INTEL_INGEST_TOKEN = randomBytes(24).toString('hex');
      const body = { agent: 'qa-tester', trigger: 'ci', status: 'SUCCEEDED', discoveries: [finding('bug:same-subject')] };
      const [a, b] = await Promise.all([1, 2].map(() =>
        http().post('/admin/intelligence/ingest').set('x-intel-token', process.env.INTEL_INGEST_TOKEN!).send(body)));
      expect([a.status, b.status]).toEqual([201, 201]);
      expect([a.body.created + b.body.created, a.body.updated + b.body.updated]).toEqual([1, 1]);

      const rows = await prisma.discovery.findMany({ where: { fingerprint: 'bug:same-subject' } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ seenCount: 2, status: 'NEW', source: 'qa-tester' });
      expect(await prisma.agentRun.count({ where: { agent: 'qa-tester' } })).toBe(2);
    });

    it('five writers at once still make one row and count every sighting', async () => {
      await Promise.all(Array.from({ length: 5 }, () => store.upsert(finding('bug:five'), 'scanner:x')));
      expect(await prisma.discovery.findUniqueOrThrow({ where: { fingerprint: 'bug:five' } })).toMatchObject({ seenCount: 5 });
    });

    it('a DONE discovery seen again stays DONE, flagged reappeared, and its critical notice stays closed', async () => {
      const admin = await staff('admin', ['intelligence.read', 'intelligence.decide']);
      const { discovery } = await store.upsert(finding('sec:leak', { severity: 'CRITICAL', kind: 'security' }), 'security-guardian');
      const key = `intel.critical:${discovery.id}`;
      expect(await prisma.staffNotification.findUniqueOrThrow({ where: { dedupeKey: key } }))
        .toMatchObject({ type: 'intel.critical', priority: 'URGENT', resolvedAt: null, link: `/intelligence?d=${discovery.id}` });

      await intel.decide(discovery.id, { action: 'done', note: 'fixed' }, admin.id);
      expect((await prisma.staffNotification.findUniqueOrThrow({ where: { dedupeKey: key } })).resolvedAt).not.toBeNull();

      await store.upsert(finding('sec:leak', { severity: 'CRITICAL', kind: 'security' }), 'security-guardian');
      const after = await prisma.discovery.findUniqueOrThrow({ where: { id: discovery.id } });
      expect(after).toMatchObject({ status: 'DONE', seenCount: 2, testResults: expect.objectContaining({ reappeared: true }) });
      expect((await prisma.staffNotification.findUniqueOrThrow({ where: { dedupeKey: key } })).resolvedAt).not.toBeNull();
      expect(await prisma.discoveryDecision.count({ where: { discoveryId: discovery.id } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'intelligence.discovery.done', entityId: discovery.id } })).toBe(1);
    });
  });

  describe('tabs', () => {
    it('each tab selects what the contract says, with cursor pages', async () => {
      const seed: Array<[string, DiscoveryStatus, DiscoveryInput['severity'], DiscoveryInput['kind']]> = [
        ['t:new-low', 'NEW', 'LOW', 'bug'],
        ['t:new-high', 'NEW', 'HIGH', 'payment'],
        ['t:pending-crit', 'PENDING_REVIEW', 'CRITICAL', 'security'],
        ['t:done-high', 'DONE', 'HIGH', 'bug'],
        ['t:rejected-crit', 'REJECTED', 'CRITICAL', 'bug'],
        ['t:deferred', 'DEFERRED', 'MEDIUM', 'market'],
        ['t:opp', 'APPROVED', 'LOW', 'opportunity'],
        ['t:opp-done', 'DONE', 'INFO', 'opportunity'],
      ];
      for (const [fp, status, severity, kind] of seed) {
        const { discovery } = await store.upsert(finding(fp, { severity, kind }), 'test');
        await prisma.discovery.update({ where: { id: discovery.id }, data: { status } });
      }
      const tab = async (t: string, extra = '') => {
        const res = await intel.list(Object.fromEntries(new URLSearchParams(`tab=${t}${extra}`)) as never);
        return res.data.map((d) => d.fingerprint).sort();
      };
      expect(await tab('new')).toEqual(['t:new-high', 't:new-low']);
      expect(await tab('critical')).toEqual(['t:new-high', 't:pending-crit']);
      expect(await tab('opportunities')).toEqual(['t:opp', 't:opp-done']);
      expect(await tab('pending')).toEqual(['t:pending-crit']);
      expect(await tab('done')).toEqual(['t:done-high', 't:opp-done']);
      expect(await tab('deferred')).toEqual(['t:deferred']);
      expect(await tab('all')).toHaveLength(seed.length);
      expect(await tab('all', '&kind=bug&severity=CRITICAL')).toEqual(['t:rejected-crit']);
      expect(await tab('all', '&q=PENDING-CRIT')).toEqual(['t:pending-crit']);

      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await intel.list({ tab: 'all', limit: 3, cursor });
        page.data.forEach((d) => seen.add(d.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen.size).toBe(seed.length);

      // pending also counts market items waiting for review
      await prisma.marketCountry.create({ data: { code: 'ML', nameAr: 'مالي', nameFr: 'Mali', nameEn: 'Mali', currency: 'XOF', dialCode: '223' } });
      await prisma.marketPaymentMethod.create({
        data: { countryCode: 'ML', key: 'orange-money-ml', name: 'Orange Money', kind: 'mobile_money', lastVerifiedAt: new Date(), verifiedBy: 'test' },
      });
      const summary = await intel.summary();
      expect(summary.counts).toEqual({ new: 2, critical: 2, opportunities: 2, pending: 2, done: 2, deferred: 1 });
    });
  });

  describe('permissions', () => {
    it('a support user with only intelligence.read can read but cannot decide, scan or ingest', async () => {
      delete process.env.INTEL_INGEST_TOKEN;
      const support = await staff('support', ['intelligence.read']);
      const { discovery } = await store.upsert(finding('perm:subject'), 'test');

      await http().get('/admin/intelligence/summary').expect(401);
      await http().get('/admin/intelligence/summary').set('authorization', support.auth).expect(200);
      await http().get(`/admin/intelligence/discoveries/${discovery.id}`).set('authorization', support.auth).expect(200);
      await http().get('/admin/intelligence/discoveries?tab=new').set('authorization', support.auth).expect(200);
      await http().post(`/admin/intelligence/discoveries/${discovery.id}/decision`).set('authorization', support.auth)
        .send({ action: 'approve' }).expect(403);
      await http().post('/admin/intelligence/scan').set('authorization', support.auth).expect(403);
      await http().post('/admin/intelligence/ingest').set('authorization', support.auth)
        .send({ agent: 'x', trigger: 'manual', status: 'SUCCEEDED' }).expect(403);

      expect(await prisma.discovery.findUniqueOrThrow({ where: { id: discovery.id } })).toMatchObject({ status: 'NEW' });
      expect(await prisma.discoveryDecision.count()).toBe(0);
    });

    it('an admin with intelligence.decide decides, and ingests with a staff session', async () => {
      delete process.env.INTEL_INGEST_TOKEN;
      const admin = await staff('admin', ['intelligence.read', 'intelligence.decide']);
      const { discovery } = await store.upsert(finding('perm:decide'), 'test');

      const res = await http().post(`/admin/intelligence/discoveries/${discovery.id}/decision`).set('authorization', admin.auth)
        .send({ action: 'defer', deferDays: 3 }).expect(200);
      expect(res.body.status).toBe('DEFERRED');
      const detail = await http().get(`/admin/intelligence/discoveries/${discovery.id}`).set('authorization', admin.auth).expect(200);
      expect(detail.body.decisions).toEqual([expect.objectContaining({ action: 'defer', actorId: admin.id, actorLabel: 'admin user' })]);
      await http().post(`/admin/intelligence/discoveries/${discovery.id}/decision`).set('authorization', admin.auth)
        .send({ action: 'done' }).expect(200);
      await http().post(`/admin/intelligence/discoveries/${discovery.id}/decision`).set('authorization', admin.auth)
        .send({ action: 'approve' }).expect(409);

      const log = await http().get('/admin/intelligence/decisions').set('authorization', admin.auth).expect(200);
      expect(log.body.map((e: { action: string }) => e.action)).toEqual(['done', 'defer']);

      const ingest = await http().post('/admin/intelligence/ingest').set('authorization', admin.auth)
        .send({ agent: 'discovery-engine', trigger: 'manual', status: 'ok', discoveries: [finding('perm:ingested')] }).expect(201);
      expect(ingest.body).toMatchObject({ created: 1, updated: 0, run: { agent: 'discovery-engine', status: 'SUCCEEDED' } });
    });

    it('token ingest: no env → 403, wrong token → 401, right token → stored; bad bodies → 400', async () => {
      const body = { agent: 'ci', trigger: 'ci', status: 'SUCCEEDED', tests: { passed: 10, failed: 0 } };
      delete process.env.INTEL_INGEST_TOKEN;
      const off = await http().post('/admin/intelligence/ingest').set('x-intel-token', 'anything-anything').send(body).expect(403);
      expect(off.body.error).toBe('INGEST_DISABLED');

      const token = randomBytes(24).toString('hex');
      process.env.INTEL_INGEST_TOKEN = token;
      const wrong = await http().post('/admin/intelligence/ingest').set('x-intel-token', `${token}0`).send(body).expect(401);
      expect(wrong.body.error).toBe('INVALID_INGEST_TOKEN');
      await http().post('/admin/intelligence/ingest').send(body).expect(401);

      const ok = await http().post('/admin/intelligence/ingest').set('x-intel-token', token).send(body).expect(201);
      expect(ok.body.run).toMatchObject({ agent: 'ci', testsPassed: 10, testsFailed: 0 });

      await http().post('/admin/intelligence/ingest').set('x-intel-token', token)
        .send({ ...body, discoveries: Array.from({ length: 201 }, (_, i) => finding(`cap:${i}`)) }).expect(400);
      await http().post('/admin/intelligence/ingest').set('x-intel-token', token).send({ ...body, unknown: 1 }).expect(400);
    });
  });

  describe('scanners', () => {
    it('run on real data: one AgentRun per scanner, discoveries without account numbers', async () => {
      const number = String(10_000_000 + Math.floor(Math.random() * 89_999_999));
      await usd();
      const category = await prisma.category.create({ data: { slug: 'gift-cards', nameAr: 'بطاقات', nameEn: 'Gift cards' } });
      await prisma.product.create({
        data: {
          sku: 'GC-STEAM-10', type: 'GIFT_CARD', delivery: 'MANUAL', nameAr: 'ستيم 10', nameEn: 'Steam 10',
          costPrice: 9, sellPrice: 10, currency: 'USD', categoryId: category.id,
        },
      });
      await prisma.marketCountry.createMany({
        data: [
          { code: 'MR', nameAr: 'موريتانيا', nameFr: 'Mauritanie', nameEn: 'Mauritania', currency: 'USD', dialCode: '222', enabled: true, lastResearchedAt: new Date() },
          { code: 'ML', nameAr: 'مالي', nameFr: 'Mali', nameEn: 'Mali', currency: 'XOF', dialCode: '223', enabled: true },
        ],
      });
      await prisma.systemSetting.create({
        data: {
          key: MANUAL_ACCOUNTS_KEY, group: 'payments',
          value: [
            { id: 'mr-1', method: 'Bankily', countries: ['MR'], accountName: '', accountNumber: number, kind: 'mobile', enabled: true },
            { id: 'all', method: 'Wave', countries: [], accountName: '', accountNumber: number, kind: 'mobile', enabled: false },
          ],
        },
      });
      for (let i = 0; i < 3; i++) {
        await prisma.storeEvent.create({ data: { kind: 'search_miss', value: 'Valorant  Points' } });
        await prisma.storeEvent.create({ data: { kind: 'server_error', value: `Order ${randomUUID()} broke`, path: `/api/v1/orders/${randomUUID()}` } });
      }

      const outcome = await app.get(ScannersService).runAll('manual');
      expect(outcome.run).toMatchObject({ agent: 'scanners', trigger: 'manual', status: 'SUCCEEDED' });

      const runs = await prisma.agentRun.findMany({ where: { agent: { startsWith: 'scanner:' } } });
      expect(runs.map((r) => [r.agent, r.trigger, r.status]).sort()).toEqual([
        ['scanner:catalog-readiness', 'app', 'SUCCEEDED'],
        ['scanner:market-staleness', 'app', 'SUCCEEDED'],
        ['scanner:payments-by-country', 'app', 'SUCCEEDED'],
        ['scanner:search-gaps', 'app', 'SUCCEEDED'],
        ['scanner:server-errors', 'app', 'SUCCEEDED'],
      ]);
      const fps = (await prisma.discovery.findMany({ select: { fingerprint: true } })).map((d) => d.fingerprint);
      expect(fps).toEqual(expect.arrayContaining([
        'payments.country-uncovered:ML', 'payments.account-all-countries:all', 'market.research-needed:ML',
        'catalog.no-price:XOF',
      ]));
      expect(fps.some((f) => f.startsWith('search-gap:'))).toBe(true);
      expect(fps.some((f) => f.startsWith('server-error:'))).toBe(true);
      expect(JSON.stringify(await prisma.discovery.findMany())).not.toContain(number);

      // a second pass only counts sightings
      const again = await app.get(ScannersService).runAll('schedule');
      expect(again.created).toBe(0);
      const summary = await intel.summary();
      expect(summary.scanners.every((s) => !s.stale)).toBe(true);
      expect(summary.agents.map((a) => a.agent)).toEqual(['scanners']);
    });
  });
});
