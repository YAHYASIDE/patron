import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';
import {
  MarketsService, accountView, accountsListing, maskNumber, researchFingerprint,
} from '../../src/modules/markets/markets.service';
import { MarketMethodInput, MarketRuleInput, STALE_DAYS_KEY } from '../../src/modules/markets/markets.types';

type Row = Record<string, any>;
const DAY = 86_400_000;

/** Enough of Prisma for the markets service, kept in memory. */
function fakePrisma() {
  const db = {
    countries: [] as Row[],
    methods: [] as Row[],
    rules: [] as Row[],
    discoveries: [] as Row[],
    settings: new Map<string, unknown>(),
  };
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([k, cond]) => {
      if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
        if ('in' in cond) return (cond.in as unknown[]).includes(row[k]);
        if ('not' in cond) return row[k] !== cond.not;
        if ('lt' in cond) return row[k] < cond.lt;
      }
      return row[k] === cond;
    });
  const groupBy = (rows: Row[]) => ({ by, where }: { by: string[]; where?: Row }) => {
    const groups = new Map<string, Row>();
    for (const r of rows.filter((x) => matches(x, where))) {
      const k = by.map((b) => r[b]).join('|');
      const g = groups.get(k) ?? { ...Object.fromEntries(by.map((b) => [b, r[b]])), _count: { _all: 0 } };
      g._count._all++;
      groups.set(k, g);
    }
    return Promise.resolve([...groups.values()]);
  };
  const researched = (rows: Row[], uniqueKey: string, fields: string[]) => ({
    findUnique: jest.fn(({ where }: { where: Row }) => Promise.resolve(rows.find((r) => r.id === where.id) ?? null)),
    findUniqueOrThrow: jest.fn(({ where }: { where: Row }) => Promise.resolve(rows.find((r) => r.id === where.id))),
    findMany: jest.fn(({ where }: { where?: Row } = {}) => Promise.resolve(rows.filter((r) => matches(r, where)))),
    groupBy: jest.fn(groupBy(rows)),
    upsert: jest.fn(({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = where[uniqueKey];
      const found = rows.find((r) => fields.every((f) => r[f] === key[f]));
      if (found) return Promise.resolve(Object.assign(found, update));
      const row = { id: randomUUID(), accountId: null, decisionById: null, decisionAt: null, decisionNote: null, createdAt: new Date(), ...create };
      rows.push(row);
      return Promise.resolve(row);
    }),
    update: jest.fn(({ where, data }: { where: Row; data: Row }) => Promise.resolve(Object.assign(rows.find((r) => r.id === where.id)!, data))),
    updateMany: jest.fn(({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return Promise.resolve({ count: hit.length });
    }),
  });
  const prisma: Row = {
    marketCountry: {
      findUnique: jest.fn(({ where }: { where: Row }) => Promise.resolve(db.countries.find((c) => c.code === where.code) ?? null)),
      findMany: jest.fn(({ where }: { where?: Row } = {}) => Promise.resolve(db.countries.filter((c) => matches(c, where)))),
      create: jest.fn(({ data }: { data: Row }) => {
        const row = { lastResearchedAt: null, ...data };
        db.countries.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: Row; data: Row }) => Promise.resolve(Object.assign(db.countries.find((c) => c.code === where.code)!, data))),
    },
    marketPaymentMethod: researched(db.methods, 'countryCode_key', ['countryCode', 'key']),
    productMarketRule: researched(db.rules, 'countryCode_scope_ref', ['countryCode', 'scope', 'ref']),
    discovery: {
      upsert: jest.fn(({ where, create, update }: { where: Row; create: Row; update: Row }) => {
        const found = db.discoveries.find((d) => d.fingerprint === where.fingerprint);
        if (found) {
          found.seenCount += update.seenCount.increment;
          found.lastSeenAt = update.lastSeenAt;
          return Promise.resolve(found);
        }
        const row = { id: randomUUID(), status: 'NEW', seenCount: 1, testResults: null, ...create };
        db.discoveries.push(row);
        return Promise.resolve(row);
      }),
      update: jest.fn(({ where, data }: { where: Row; data: Row }) => Promise.resolve(Object.assign(db.discoveries.find((d) => d.id === where.id)!, data))),
    },
    systemSetting: {
      findUnique: jest.fn(({ where }: { where: Row }) =>
        Promise.resolve(db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null)),
    },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  prisma.$executeRaw = jest.fn().mockResolvedValue(1);
  return { prisma, db };
}

const country = (code: string, over: Row = {}) => ({
  code, nameAr: code, nameFr: code, nameEn: code, currency: 'XOF', currencies: ['XOF'], languages: ['fr'], dialCode: '223',
  enabled: true, notes: null, lastResearchedAt: null, ...over,
});

const source = { url: 'https://example.test/page', title: 'Provider page', accessedAt: '2026-10-01' };
const method = (over: Partial<MarketMethodInput> = {}): MarketMethodInput => ({
  key: 'orange-money-ml', name: 'Orange Money', kind: 'mobile', currency: 'XOF', sources: [source], confidence: 90, verifiedBy: 'market-scout', ...over,
});
const rule = (over: Partial<MarketRuleInput> = {}): MarketRuleInput => ({
  scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', sources: [source], confidence: 80, verifiedBy: 'market-scout', ...over,
});

/** Fake accounts, numbers made up at runtime. */
const account = (over: Row = {}) => ({
  id: randomUUID(), method: 'Wallet', countries: ['ML'], accountName: '', accountNumber: String(10_000_000 + Math.floor(Math.random() * 1e7)),
  kind: 'mobile', enabled: true, ...over,
});

const ACTOR = { id: randomUUID(), label: 'staff' };

describe('MarketsService', () => {
  let prisma: Row;
  let db: ReturnType<typeof fakePrisma>['db'];
  let audit: { record: jest.Mock; recordAsync: jest.Mock };
  let service: MarketsService;

  beforeEach(() => {
    ({ prisma, db } = fakePrisma());
    audit = { record: jest.fn().mockResolvedValue(undefined), recordAsync: jest.fn() };
    service = new MarketsService(prisma as never, audit as never);
    db.countries.push(country('ML'), country('MR', { currency: 'MRU', currencies: ['MRU'], dialCode: '222' }), country('SN', { enabled: false }));
  });

  describe('research upserts', () => {
    it('adds new methods for review and keeps the owner\'s decision when the same research comes again', async () => {
      await expect(service.upsertMethods('ml', [method(), method({ key: 'moov-money-ml', name: 'Moov Money' })], ACTOR))
        .resolves.toEqual({ created: 2, updated: 0 });
      expect(db.methods.map((m) => m.status)).toEqual(['PENDING_REVIEW', 'PENDING_REVIEW']);
      expect(db.countries[0].lastResearchedAt).toBeInstanceOf(Date);

      const om = db.methods[0];
      const accountId = randomUUID();
      Object.assign(om, { status: 'ACTIVE', accountId, decisionById: ACTOR.id, decisionNote: 'ok', lastVerifiedAt: new Date(0) });

      await expect(service.upsertMethods('ML', [method({ fees: '1%', confidence: 95 })], { label: 'market-scout' }))
        .resolves.toEqual({ created: 0, updated: 1 });
      expect(om).toMatchObject({ status: 'ACTIVE', accountId, decisionById: ACTOR.id, decisionNote: 'ok', fees: '1%', confidence: 95 });
      expect(om.lastVerifiedAt.getTime()).toBeGreaterThan(0);
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({
        action: 'markets.methods.upsert', entityId: 'ML', actorId: undefined, after: expect.objectContaining({ by: 'market-scout', updated: 1 }),
      }));
    });

    it('counts a key repeated in one call once, and refuses an unknown country or an item without a source', async () => {
      await expect(service.upsertMethods('ML', [method({ name: 'A' }), method({ name: 'B' })], ACTOR)).resolves.toEqual({ created: 1, updated: 0 });
      expect(db.methods[0].name).toBe('B');
      await expect(service.upsertMethods('ZZ', [method()], ACTOR)).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
      await expect(service.upsertMethods('M1', [method()], ACTOR)).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
      await expect(service.upsertMethods('ML', [method({ sources: [] })], ACTOR)).rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [method({ sources: [{ ...source, url: 'javascript:x' }] })], ACTOR))
        .rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [method({ kind: 'magic' })], ACTOR)).rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [method({ key: '' })], ACTOR)).rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [method({ name: ' ' })], ACTOR)).rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [method({ currency: 'X1' })], ACTOR)).rejects.toMatchObject({ response: { error: 'INVALID_MARKET_ITEM' } });
      await expect(service.upsertMethods('ML', [], ACTOR)).resolves.toEqual({ created: 0, updated: 0 });
    });

    it('cleans what research sends: confidence kept in 0–100, verifier defaults to the actor, source fields trimmed', async () => {
      await service.upsertMethods('ML', [method({
        key: ' Wave-ML ', confidence: 140, verifiedBy: '', provider: ' Wave ', currency: 'xof',
        sources: [{ url: 'https://wave.example.test', title: '', publisher: ' Wave ', accessedAt: '' }],
      })], { label: 'market-scout' });
      expect(db.methods[0]).toMatchObject({ key: 'wave-ml', confidence: 100, verifiedBy: 'market-scout', provider: 'Wave', currency: 'XOF' });
      expect(db.methods[0].sources[0]).toMatchObject({ url: 'https://wave.example.test', title: 'https://wave.example.test', publisher: 'Wave' });
      await service.upsertMethods('ML', [method({ key: 'cash-ml', kind: 'cash', confidence: Number.NaN, currency: undefined })], ACTOR);
      expect(db.methods[1]).toMatchObject({ confidence: 0, currency: null, fees: null, provider: null });
    });

    it('a second upsert that loses the race for a new key runs again as an update', async () => {
      const conflict = new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });
      prisma.$transaction.mockImplementationOnce(() => Promise.reject(conflict));
      await expect(service.upsertMethods('ML', [method()], ACTOR)).resolves.toEqual({ created: 1, updated: 0 });
      prisma.$transaction.mockImplementationOnce(() => Promise.reject(new Error('db down')));
      await expect(service.upsertMethods('ML', [method()], ACTOR)).rejects.toThrow('db down');
    });

    it('rules: new ones wait for review; an approved rule keeps its status unless research reports another availability', async () => {
      await expect(service.upsertRules('ML', [rule(), rule({ scope: 'product', ref: 'GC-APPLE-US-10' })], ACTOR)).resolves.toEqual({ created: 2, updated: 0 });
      const brand = db.rules[0];
      Object.assign(brand, { status: 'APPROVED', decisionById: ACTOR.id });

      await expect(service.upsertRules('ML', [rule({ note: 'needs a US Apple ID' })], ACTOR)).resolves.toEqual({ created: 0, updated: 1 });
      expect(brand).toMatchObject({ status: 'APPROVED', note: 'needs a US Apple ID', decisionById: ACTOR.id });

      await service.upsertRules('ML', [rule({ availability: 'AVAILABLE' })], ACTOR);
      expect(brand).toMatchObject({ status: 'PENDING_REVIEW', availability: 'AVAILABLE' });
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ after: expect.objectContaining({ reopened: 1 }) }));
    });

    it('rules: refuses a bad scope, an empty ref, an unknown availability and an unknown country', async () => {
      const bad = { response: { error: 'INVALID_MARKET_ITEM' } };
      await expect(service.upsertRules('ML', [rule({ scope: 'shop' as never })], ACTOR)).rejects.toMatchObject(bad);
      await expect(service.upsertRules('ML', [rule({ ref: '' })], ACTOR)).rejects.toMatchObject(bad);
      await expect(service.upsertRules('ML', [rule({ availability: 'MAYBE' as never })], ACTOR)).rejects.toMatchObject(bad);
      await expect(service.upsertRules('XX', [rule()], ACTOR)).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
      await expect(service.upsertRules('ML', [], ACTOR)).resolves.toEqual({ created: 0, updated: 0 });
    });
  });

  describe('decisions', () => {
    let id: string;
    beforeEach(async () => {
      await service.upsertMethods('ML', [method()], ACTOR);
      id = db.methods[0].id;
    });

    it('approve, defer and reject record who decided, when and why', async () => {
      const approved = await service.decideMethod(id, 'approve', 'official page', ACTOR.id!);
      expect(approved).toMatchObject({ status: 'APPROVED', decisionById: ACTOR.id, decisionNote: 'official page' });
      expect(approved.decisionAt).toBeInstanceOf(Date);
      expect((await service.decideMethod(id, 'defer', undefined, ACTOR.id!)).status).toBe('DEFERRED');
      expect((await service.decideMethod(id, 'reject', '', ACTOR.id!))).toMatchObject({ status: 'REJECTED', decisionNote: null });
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ action: 'markets.method.reject', entityId: id }));
    });

    it('an ACTIVE method stays ACTIVE when approved again, and loses its account when rejected or deferred', async () => {
      const accountId = randomUUID();
      Object.assign(db.methods[0], { status: 'ACTIVE', accountId });
      expect(await service.decideMethod(id, 'approve', undefined, ACTOR.id!)).toMatchObject({ status: 'ACTIVE', accountId });
      expect(await service.decideMethod(id, 'defer', undefined, ACTOR.id!)).toMatchObject({ status: 'DEFERRED', accountId: null });
      Object.assign(db.methods[0], { status: 'ACTIVE', accountId });
      expect(await service.decideMethod(id, 'reject', undefined, ACTOR.id!)).toMatchObject({ status: 'REJECTED', accountId: null });
    });

    it('rules are decided the same way; unknown ids are 404', async () => {
      await service.upsertRules('ML', [rule()], ACTOR);
      const ruleId = db.rules[0].id;
      expect(await service.decideRule(ruleId, 'approve', 'checked', ACTOR.id!)).toMatchObject({ status: 'APPROVED', decisionById: ACTOR.id });
      expect((await service.decideRule(ruleId, 'reject', undefined, ACTOR.id!)).status).toBe('REJECTED');
      expect((await service.decideRule(ruleId, 'defer', undefined, ACTOR.id!)).status).toBe('DEFERRED');
      await expect(service.decideRule(randomUUID(), 'approve', undefined, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_RULE_NOT_FOUND' } });
      await expect(service.decideMethod(randomUUID(), 'approve', undefined, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_METHOD_NOT_FOUND' } });
    });
  });

  describe('link-account', () => {
    let id: string;
    let accounts: Row[];
    beforeEach(async () => {
      await service.upsertMethods('ML', [method()], ACTOR);
      id = db.methods[0].id;
      accounts = [
        account({ countries: ['ML'] }),
        account({ countries: ['ML'], enabled: false }),
        account({ countries: ['ML'], accountNumber: '  ' }),
        account({ countries: ['MR'] }),
        account({ countries: [] }),
      ];
      db.settings.set(MANUAL_ACCOUNTS_KEY, accounts);
    });

    it('refuses a method that is not approved', async () => {
      await expect(service.linkAccount(id, accounts[0].id, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'METHOD_NOT_APPROVED' } });
      Object.assign(db.methods[0], { status: 'REJECTED' });
      await expect(service.linkAccount(id, accounts[0].id, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'METHOD_NOT_APPROVED' } });
      await expect(service.linkAccount(randomUUID(), accounts[0].id, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_METHOD_NOT_FOUND' } });
    });

    it('refuses an unknown account, a switched-off one, one without a number and one of another country', async () => {
      Object.assign(db.methods[0], { status: 'APPROVED' });
      const err = (e: string) => ({ response: { error: e } });
      await expect(service.linkAccount(id, 'nope', ACTOR.id!)).rejects.toMatchObject(err('ACCOUNT_NOT_FOUND'));
      await expect(service.linkAccount(id, accounts[1].id, ACTOR.id!)).rejects.toMatchObject(err('ACCOUNT_NOT_USABLE'));
      await expect(service.linkAccount(id, accounts[2].id, ACTOR.id!)).rejects.toMatchObject(err('ACCOUNT_NOT_USABLE'));
      // the Mali rule: a Mauritania-only account never serves a Mali method
      await expect(service.linkAccount(id, accounts[3].id, ACTOR.id!)).rejects.toMatchObject(err('ACCOUNT_OTHER_COUNTRY'));
      // an account for "everywhere" (no countries) does not list Mali either
      await expect(service.linkAccount(id, accounts[4].id, ACTOR.id!)).rejects.toMatchObject(err('ACCOUNT_OTHER_COUNTRY'));
      expect(db.methods[0]).toMatchObject({ status: 'APPROVED', accountId: null });
    });

    it('links an approved method to a usable account of its country without touching the account', async () => {
      Object.assign(db.methods[0], { status: 'APPROVED' });
      const before = JSON.stringify(accounts);
      const linked = await service.linkAccount(id, accounts[0].id, ACTOR.id!);
      expect(linked).toMatchObject({ status: 'ACTIVE', accountId: accounts[0].id });
      expect(JSON.stringify(db.settings.get(MANUAL_ACCOUNTS_KEY))).toBe(before);
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ action: 'markets.method.link_account' }));
    });

    it('refuses when the method was rejected between the checks and the write', async () => {
      Object.assign(db.methods[0], { status: 'APPROVED' });
      prisma.marketPaymentMethod.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.linkAccount(id, accounts[0].id, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'METHOD_NOT_APPROVED' } });
    });

    it('reads accounts saved in the older one-country form', async () => {
      Object.assign(db.methods[0], { status: 'APPROVED' });
      const legacy = { id: 'legacy-1', method: 'Old', country: 'ML', accountNumber: '12345678' };
      db.settings.set(MANUAL_ACCOUNTS_KEY, [legacy]);
      await expect(service.linkAccount(id, 'legacy-1', ACTOR.id!)).resolves.toMatchObject({ status: 'ACTIVE', accountId: 'legacy-1' });
      db.settings.set(MANUAL_ACCOUNTS_KEY, { not: 'a list' });
      expect(await service.manualAccounts()).toEqual([]);
    });
  });

  describe('reading', () => {
    it('detail lists only the accounts that name this country, numbers masked: an MR-only account never serves ML', async () => {
      const mr = account({ countries: ['MR'], method: 'Bankily' });
      const ml = account({ countries: ['ML', 'NE'] });
      const everywhere = account({ countries: [] });
      const off = account({ countries: ['ML'], enabled: false });
      db.settings.set(MANUAL_ACCOUNTS_KEY, [mr, ml, everywhere, off]);

      const detail = await service.detail('ml');
      expect(detail.country.code).toBe('ML');
      expect(detail.accounts.map((a) => a.id)).toEqual([ml.id, off.id]);
      expect(detail.accounts[0]).toEqual({
        id: ml.id, method: ml.method, kind: 'mobile', countries: ['ML', 'NE'], enabled: true, usable: true, number: `••••${ml.accountNumber.slice(-3)}`,
      });
      expect(detail.accounts[1]).toMatchObject({ enabled: false, usable: false });
      expect(JSON.stringify(detail)).not.toContain(ml.accountNumber);
      expect((await service.detail('MR')).accounts.map((a) => a.id)).toEqual([mr.id]);
      await expect(service.detail('ZZ')).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
    });

    it('counts per country, and stale facts by markets.stale_days (rejected ones are not stale)', async () => {
      await service.upsertMethods('ML', [method(), method({ key: 'moov-ml' }), method({ key: 'old-ml' })], ACTOR);
      await service.upsertRules('ML', [rule(), rule({ ref: 'netflix' })], ACTOR);
      const [om, moov, old] = db.methods;
      Object.assign(om, { status: 'ACTIVE', lastVerifiedAt: new Date(Date.now() - 100 * DAY) });
      Object.assign(moov, { status: 'REJECTED', lastVerifiedAt: new Date(Date.now() - 400 * DAY) });
      Object.assign(old, { status: 'DEFERRED', lastVerifiedAt: new Date(Date.now() - 40 * DAY) });
      Object.assign(db.rules[0], { status: 'APPROVED', lastVerifiedAt: new Date(Date.now() - 95 * DAY) });

      const ml = (await service.list()).find((c) => c.code === 'ML')!;
      expect(ml.methods).toEqual({ pending: 0, approved: 0, active: 1, rejected: 1, deferred: 1 });
      expect(ml.rules).toEqual({ pending: 1, approved: 1, rejected: 0, deferred: 0 });
      expect(ml.stale).toBe(2); // OM (100 days) and the rule (95 days); the rejected one does not count
      const mr = (await service.list()).find((c) => c.code === 'MR')!;
      expect(mr).toMatchObject({ stale: 0, methods: { pending: 0 } });

      db.settings.set(STALE_DAYS_KEY, 30);
      expect((await service.list()).find((c) => c.code === 'ML')!.stale).toBe(3);
      const detail = await service.detail('ML');
      expect(detail.methods.map((m) => [m.key, m.stale])).toEqual([['orange-money-ml', true], ['moov-ml', false], ['old-ml', true]]);
    });

    it('stale_days falls back to 90 when unset or not a number', async () => {
      expect(await service.staleDays()).toBe(90);
      db.settings.set(STALE_DAYS_KEY, 'abc');
      expect(await service.staleDays()).toBe(90);
      db.settings.set(STALE_DAYS_KEY, 0);
      expect(await service.staleDays()).toBe(90);
      db.settings.set(STALE_DAYS_KEY, '45');
      expect(await service.staleDays()).toBe(45);
      const now = new Date('2026-10-20T00:00:00.000Z');
      expect((await service.staleCutoff(now)).toISOString()).toBe('2026-09-05T00:00:00.000Z');
    });

    it('public rules only for an enabled country', async () => {
      prisma.productMarketRule.findMany.mockResolvedValueOnce([{ scope: 'brand', ref: 'x', availability: 'UNAVAILABLE', note: null }]);
      await expect(service.publicRules('ml')).resolves.toHaveLength(1);
      expect(prisma.productMarketRule.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { countryCode: 'ML', status: 'APPROVED' } }));
      await expect(service.publicRules('SN')).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
      await expect(service.publicRules('XX')).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
      await service.publicList();
      expect(prisma.marketCountry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { enabled: true } }));
    });
  });

  describe('countries', () => {
    const dto = { code: 'BF', nameAr: 'بوركينا فاسو', nameFr: 'Burkina Faso', nameEn: 'Burkina Faso', currency: 'XOF', currencies: ['USD', 'XOF'], dialCode: '226' };

    it('a new country starts switched off and raises one research discovery', async () => {
      const created = await service.create(dto, ACTOR.id!);
      expect(created).toMatchObject({ code: 'BF', enabled: false, currencies: ['XOF', 'USD'], languages: [] });
      expect(db.discoveries).toHaveLength(1);
      expect(db.discoveries[0]).toMatchObject({
        fingerprint: researchFingerprint('BF'), kind: 'market', severity: 'MEDIUM', verified: true, confidence: 100, status: 'NEW', source: 'markets',
      });
      expect(db.discoveries[0].title).toContain('بوركينا فاسو');
      expect(audit.record).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'markets.country.create', entityId: 'BF', actorId: ACTOR.id }));
    });

    it('refuses an existing country, XX, and a duplicate that slips past the check', async () => {
      await expect(service.create({ ...dto, code: 'ML' }, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_EXISTS' } });
      await expect(service.create({ ...dto, code: 'XX' }, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_CODE_RESERVED' } });
      prisma.$transaction.mockImplementationOnce(() => Promise.reject(new Prisma.PrismaClientKnownRequestError('u', { code: 'P2002', clientVersion: 'x' })));
      await expect(service.create(dto, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_EXISTS' } });
      prisma.$transaction.mockImplementationOnce(() => Promise.reject(new Error('db down')));
      await expect(service.create(dto, ACTOR.id!)).rejects.toThrow('db down');
    });

    it('the discovery is only seen again, never reopened when done or rejected', async () => {
      db.discoveries.push({ id: 'd1', fingerprint: researchFingerprint('BF'), status: 'DONE', seenCount: 1, testResults: { ran: 1 } });
      await service.create(dto, ACTOR.id!);
      expect(db.discoveries).toHaveLength(1);
      expect(db.discoveries[0]).toMatchObject({ status: 'DONE', seenCount: 2, testResults: { ran: 1, reappeared: true } });

      db.discoveries[0] = { id: 'd2', fingerprint: researchFingerprint('GH'), status: 'PENDING_REVIEW', seenCount: 3, testResults: null };
      await service.create({ ...dto, code: 'GH' }, ACTOR.id!);
      expect(db.discoveries[0]).toMatchObject({ status: 'PENDING_REVIEW', seenCount: 4, testResults: null });

      db.discoveries[0] = { id: 'd3', fingerprint: researchFingerprint('GN'), status: 'REJECTED', seenCount: 1, testResults: null };
      await service.create({ ...dto, code: 'GN' }, ACTOR.id!);
      expect(db.discoveries[0].testResults).toMatchObject({ reappeared: true });
    });

    it('update keeps the paying currency first and audits enabling', async () => {
      const after = await service.update('SN', { enabled: true, currencies: ['USD'], notes: '' }, ACTOR.id!);
      expect(after).toMatchObject({ enabled: true, currency: 'XOF', currencies: ['XOF', 'USD'], notes: null });
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ action: 'markets.country.enable' }));

      await service.update('SN', { currency: 'USD' }, ACTOR.id!);
      expect(db.countries[2]).toMatchObject({ currency: 'USD', currencies: ['USD', 'XOF'] });

      await service.update('SN', { enabled: false, nameAr: 'س', nameFr: 'S', nameEn: 'S', dialCode: '221', languages: ['fr', 'fr', 'wo'] }, ACTOR.id!);
      expect(db.countries[2]).toMatchObject({ enabled: false, nameAr: 'س', languages: ['fr', 'wo'] });
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ action: 'markets.country.disable' }));

      await service.update('SN', { notes: 'studying' }, ACTOR.id!);
      expect(audit.record).toHaveBeenLastCalledWith(prisma, expect.objectContaining({ action: 'markets.country.update' }));
      await expect(service.update('ZZ', {}, ACTOR.id!)).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });
    });
  });
});

describe('market helpers', () => {
  it('masks numbers', () => {
    expect(maskNumber('')).toBe('');
    expect(maskNumber('1234')).toBe('••••');
    expect(maskNumber('22 33 44 55')).toBe('••••455');
  });

  it('lists only accounts that name the country', () => {
    const list = [account({ countries: ['MR'] }), account({ countries: ['ML'] }), account({ countries: [] })] as never[];
    expect(accountsListing(list, 'ML')).toHaveLength(1);
    expect(accountView(account({ accountNumber: '' }) as never)).toMatchObject({ usable: false, number: '' });
  });
});
