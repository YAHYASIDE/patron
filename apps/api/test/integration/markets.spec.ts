import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';
import { MarketsService, researchFingerprint } from '../../src/modules/markets/markets.service';
import { MarketMethodInput, MarketRuleInput } from '../../src/modules/markets/markets.types';

const source = { url: 'https://example.test/provider', title: 'Provider page', accessedAt: '2026-10-01' };
const method = (over: Partial<MarketMethodInput> = {}): MarketMethodInput => ({
  key: 'orange-money-ml', name: 'Orange Money', kind: 'mobile', currency: 'XOF', sources: [source], confidence: 90, verifiedBy: 'market-scout', ...over,
});
const rule = (over: Partial<MarketRuleInput> = {}): MarketRuleInput => ({
  scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', sources: [source], confidence: 80, verifiedBy: 'market-scout', ...over,
});
/** Made-up receiving numbers, never real ones. */
const fakeNumber = () => String(Math.floor(10_000_000 + Math.random() * 89_999_999));

/**
 * Markets on a real Postgres: (country, key) and (country, scope, ref) stay unique when the same
 * research arrives twice at once, the owner's decision survives a re-research, an account is
 * linked only when it serves the country (and is never changed), and the store sees only enabled
 * countries and approved rules.
 */
describe('Markets (Postgres)', () => {
  let prisma: PrismaService;
  let service: MarketsService;
  let ownerId: string;
  const scout = { label: 'market-scout' };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new MarketsService(prisma, new AuditService(prisma));
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    ownerId = (await prisma.user.create({ data: { email: `owner-${randomUUID()}@test.local`, fullName: 'Owner', passwordHash: 'x' } })).id;
    await prisma.marketCountry.createMany({
      data: [
        { code: 'MR', nameAr: 'موريتانيا', nameFr: 'Mauritanie', nameEn: 'Mauritania', currency: 'MRU', currencies: ['MRU'], dialCode: '222', enabled: true },
        { code: 'ML', nameAr: 'مالي', nameFr: 'Mali', nameEn: 'Mali', currency: 'XOF', currencies: ['XOF', 'USD'], dialCode: '223', enabled: true },
        { code: 'SN', nameAr: 'السنغال', nameFr: 'Sénégal', nameEn: 'Senegal', currency: 'XOF', currencies: ['XOF'], dialCode: '221', enabled: false },
      ],
    });
  });

  it('the same research sent several times at once makes one row per key, and keeps the decision', async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => service.upsertMethods('ML', [method()], scout)));
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.created + r.updated, 0)).toBe(4);
    expect(await prisma.marketPaymentMethod.count()).toBe(1);

    const row = await prisma.marketPaymentMethod.findFirstOrThrow();
    expect(row.status).toBe('PENDING_REVIEW');
    await service.decideMethod(row.id, 'approve', 'provider page checked', ownerId);

    await service.upsertMethods('ML', [method({ fees: 'free to receive', confidence: 95 })], scout);
    const again = await prisma.marketPaymentMethod.findUniqueOrThrow({ where: { id: row.id } });
    expect(again).toMatchObject({ status: 'APPROVED', decisionById: ownerId, decisionNote: 'provider page checked', fees: 'free to receive', confidence: 95 });
    expect(again.lastVerifiedAt.getTime()).toBeGreaterThan(row.lastVerifiedAt.getTime());
    // the same key in another country is another method
    await expect(service.upsertMethods('MR', [method()], scout)).resolves.toEqual({ created: 1, updated: 0 });
    expect(await prisma.auditLog.count({ where: { action: 'markets.methods.upsert' } })).toBe(6);
  });

  it('rules are unique per (country, scope, ref) under concurrency', async () => {
    await Promise.all(Array.from({ length: 3 }, () => service.upsertRules('ML', [rule(), rule({ scope: 'product', ref: 'gc-apple-us' })], scout)));
    expect(await prisma.productMarketRule.count()).toBe(2);
    expect((await prisma.marketCountry.findUniqueOrThrow({ where: { code: 'ML' } })).lastResearchedAt).not.toBeNull();
  });

  it('links an approved method only to a usable account that lists the country, and never edits the account', async () => {
    const mr = { id: randomUUID(), method: 'Wallet MR', countries: ['MR'], accountName: '', accountNumber: fakeNumber(), kind: 'mobile', enabled: true };
    const off = { id: randomUUID(), method: 'Off', countries: ['ML'], accountName: '', accountNumber: fakeNumber(), kind: 'mobile', enabled: false };
    const ml = { id: randomUUID(), method: 'Wallet ML', countries: ['ML'], accountName: '', accountNumber: fakeNumber(), kind: 'mobile', enabled: true };
    const setting = await prisma.systemSetting.create({ data: { key: MANUAL_ACCOUNTS_KEY, value: [mr, off, ml], group: 'payments' } });

    await service.upsertMethods('ML', [method()], scout);
    const { id } = await prisma.marketPaymentMethod.findFirstOrThrow();

    await expect(service.linkAccount(id, ml.id, ownerId)).rejects.toMatchObject({ response: { error: 'METHOD_NOT_APPROVED' } });
    await service.decideMethod(id, 'approve', undefined, ownerId);
    await expect(service.linkAccount(id, randomUUID(), ownerId)).rejects.toMatchObject({ response: { error: 'ACCOUNT_NOT_FOUND' } });
    await expect(service.linkAccount(id, off.id, ownerId)).rejects.toMatchObject({ response: { error: 'ACCOUNT_NOT_USABLE' } });
    await expect(service.linkAccount(id, mr.id, ownerId)).rejects.toMatchObject({ response: { error: 'ACCOUNT_OTHER_COUNTRY' } });

    const linked = await service.linkAccount(id, ml.id, ownerId);
    expect(linked).toMatchObject({ status: 'ACTIVE', accountId: ml.id });
    const after = await prisma.systemSetting.findUniqueOrThrow({ where: { key: MANUAL_ACCOUNTS_KEY } });
    expect(after.value).toEqual(setting.value);
    expect(after.updatedAt).toEqual(setting.updatedAt);

    // the detail offers only Mali's accounts, numbers masked
    const detail = await service.detail('ML');
    expect(detail.accounts.map((a) => a.id)).toEqual([off.id, ml.id]);
    expect(JSON.stringify(detail)).not.toContain(ml.accountNumber);
    expect((await service.detail('MR')).accounts.map((a) => a.id)).toEqual([mr.id]);

    // deferring an ACTIVE method unlinks it
    expect(await service.decideMethod(id, 'defer', 'later', ownerId)).toMatchObject({ status: 'DEFERRED', accountId: null });
    expect(await prisma.auditLog.count({ where: { action: { in: ['markets.method.approve', 'markets.method.link_account', 'markets.method.defer'] } } })).toBe(3);
  });

  it('the store sees only enabled countries and approved rules', async () => {
    await service.upsertRules('ML', [rule(), rule({ ref: 'netflix', availability: 'UNAVAILABLE' }), rule({ ref: 'pubg', availability: 'AVAILABLE' })], scout);
    await service.upsertRules('SN', [rule()], scout);
    const [apple, netflix] = await prisma.productMarketRule.findMany({ where: { countryCode: 'ML' }, orderBy: { ref: 'asc' } });
    await service.decideRule(apple.id, 'approve', undefined, ownerId);
    await service.decideRule(netflix.id, 'reject', 'wrong', ownerId);
    const sn = await prisma.productMarketRule.findFirstOrThrow({ where: { countryCode: 'SN' } });
    await service.decideRule(sn.id, 'approve', undefined, ownerId);

    expect((await service.publicList()).map((c) => c.code)).toEqual(['ML', 'MR']);
    expect(Object.keys((await service.publicList())[0]).sort()).toEqual(
      ['code', 'currencies', 'currency', 'dialCode', 'languages', 'nameAr', 'nameEn', 'nameFr'],
    );
    expect(await service.publicRules('ML')).toEqual([{ scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', note: null }]);
    await expect(service.publicRules('SN')).rejects.toMatchObject({ response: { error: 'MARKET_NOT_FOUND' } });

    // the owner turns Senegal on: it appears, with its approved rule
    await service.update('SN', { enabled: true }, ownerId);
    expect((await service.publicList()).map((c) => c.code)).toEqual(['ML', 'MR', 'SN']);
    expect(await service.publicRules('sn')).toHaveLength(1);
  });

  it('a new country is created switched off with one research discovery; counts and staleness per country', async () => {
    const bf = await service.create(
      { code: 'BF', nameAr: 'بوركينا فاسو', nameFr: 'Burkina Faso', nameEn: 'Burkina Faso', currency: 'XOF', dialCode: '226' },
      ownerId,
    );
    expect(bf).toMatchObject({ enabled: false, currencies: ['XOF'] });
    const d = await prisma.discovery.findUniqueOrThrow({ where: { fingerprint: researchFingerprint('BF') } });
    expect(d).toMatchObject({ kind: 'market', severity: 'MEDIUM', verified: true, confidence: 100, status: 'NEW', seenCount: 1 });
    await expect(service.create({ ...bf, dialCode: '226', notes: undefined }, ownerId)).rejects.toMatchObject({ response: { error: 'MARKET_EXISTS' } });

    await service.upsertMethods('ML', [method(), method({ key: 'moov-money-ml' })], scout);
    await prisma.marketPaymentMethod.updateMany({ where: { key: 'moov-money-ml' }, data: { lastVerifiedAt: new Date(Date.now() - 120 * 86_400_000) } });
    const ml = (await service.list()).find((c) => c.code === 'ML');
    expect(ml).toMatchObject({ methods: { pending: 2, approved: 0, active: 0 }, stale: 1 });
    expect((await service.list()).find((c) => c.code === 'BF')).toMatchObject({ enabled: false, stale: 0 });
  });
});
