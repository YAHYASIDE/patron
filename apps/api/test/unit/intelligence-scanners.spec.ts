import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';

import {
  CatalogProduct, CatalogReadinessScanner, CurrencyState, brandKeyOf, missingInputFindings, noPriceFindings,
  noProviderFindings, regionLockedFindings, skuRegion,
} from '../../src/modules/intelligence/scanners/catalog-readiness.scanner';
import { PaymentsByCountryScanner, paymentFindings } from '../../src/modules/intelligence/scanners/payments-by-country.scanner';
import {
  DEFAULT_STALE_DAYS, MarketStalenessScanner, staleDays, stalenessFindings,
} from '../../src/modules/intelligence/scanners/market-staleness.scanner';
import { ServerErrorsScanner, serverErrorFindings } from '../../src/modules/intelligence/scanners/server-errors.scanner';
import { SearchGapsScanner, searchGapFindings } from '../../src/modules/intelligence/scanners/search-gaps.scanner';
import { ScannersService } from '../../src/modules/intelligence/scanners/scanners.service';
import { ManualAccount } from '../../src/modules/payments/gateways/manual.gateway';
import { errorFingerprint } from '../../src/modules/staff-notifications/staff-events.service';

const NOW = new Date('2026-10-20T03:17:00.000Z');
const DAY = 86_400_000;
/** Fake receiving numbers, made up per run. They must never reach a discovery. */
const fakeNumber = () => `${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

const product = (over: Partial<CatalogProduct> = {}): CatalogProduct => ({
  id: randomUUID(), sku: 'GC-STEAM-10', nameAr: 'ستيم 10', type: 'GIFT_CARD', delivery: 'MANUAL', prices: [], providers: [],
  game: null, category: { slug: 'gift-cards' }, ...over,
});
const ML = { code: 'ML', nameAr: 'مالي', currency: 'XOF' };
const MR = { code: 'MR', nameAr: 'موريتانيا', currency: 'MRU' };

describe('catalog-readiness rules', () => {
  it('reads the region segment of an SKU, never the type prefix', () => {
    expect(skuRegion('GC-APPLE-US-25')).toBe('US');
    expect(skuRegion('GC-STEAM-10')).toBeNull();
    expect(skuRegion('US-THING-10')).toBeNull();
    expect(brandKeyOf('GC-APPLE-US-25')).toBe('gc-apple-us');
    expect(brandKeyOf('SOLO')).toBe('solo');
  });

  it('flags AUTO_PROVIDER products with no ready route', () => {
    const ready = { isActive: true, provider: { isActive: true, isHealthy: true } };
    const sick = { isActive: true, provider: { isActive: true, isHealthy: false } };
    const found = noProviderFindings([
      product({ sku: 'TOP-A-1', delivery: 'AUTO_PROVIDER', providers: [sick] }),
      product({ sku: 'TOP-B-1', delivery: 'AUTO_PROVIDER', providers: [sick, ready] }),
      product({ sku: 'TOP-C-1', delivery: 'MANUAL' }),
    ]);
    expect(found.map((f) => f.fingerprint)).toEqual(['catalog.no-provider:TOP-A-1']);
    expect(found[0]).toMatchObject({ kind: 'catalog', severity: 'HIGH' });
  });

  it('flags a served currency that cannot price products without their own price', () => {
    const states = new Map<string, CurrencyState>([
      ['XOF', { exists: true, active: true, hasRate: false }],
      ['MRU', { exists: true, active: true, hasRate: true }],
    ]);
    const found = noPriceFindings(
      [product({ sku: 'A-1' }), product({ sku: 'B-1', prices: [{ currencyCode: 'XOF', isActive: true }] })],
      [ML, MR, { code: 'NE', nameAr: 'النيجر', currency: 'XOF' }],
      states,
    );
    expect(found).toHaveLength(1);
    expect(found[0].fingerprint).toBe('catalog.no-price:XOF');
    expect(found[0].description).toContain('A-1');
    expect(found[0].description).not.toContain('B-1');
    expect(found[0].impact).toContain('ML/NE');
  });

  it('an inactive or unknown currency blocks even products with their own price', () => {
    const own = product({ prices: [{ currencyCode: 'DZD', isActive: true }] });
    const dz = { code: 'DZ', nameAr: 'الجزائر', currency: 'DZD' };
    expect(noPriceFindings([own], [dz], new Map([['DZD', { exists: true, active: false, hasRate: true }]]))).toHaveLength(1);
    expect(noPriceFindings([own], [dz], new Map())[0].proposal).toContain('فعّل');
    expect(noPriceFindings([], [dz], new Map())).toHaveLength(0);
  });

  it('flags game top-ups whose game asks for no account', () => {
    const withInputs = { slug: 'pubg', nameAr: 'ببجي', inputSchema: [{ key: 'playerId', required: true }] };
    const empty = { slug: 'ff', nameAr: 'فري فاير', inputSchema: [] };
    const found = missingInputFindings([
      product({ sku: 'TOP-PUBG-60', type: 'GAME_TOPUP', game: withInputs }),
      product({ sku: 'TOP-FF-100', type: 'GAME_TOPUP', game: empty }),
      product({ sku: 'TOP-FF-200', type: 'GAME_TOPUP', game: empty }),
      product({ sku: 'TOP-X-1', type: 'GAME_TOPUP' }),
      product({ sku: 'GC-X-1', type: 'GIFT_CARD' }),
    ]);
    expect(found.map((f) => f.fingerprint).sort()).toEqual(['catalog.missing-inputs:ff', 'catalog.missing-inputs:top-x-1']);
    expect(found.find((f) => f.fingerprint.endsWith(':ff'))!.description).toContain('TOP-FF-200');
  });

  it('flags region-locked brands without a rule in every enabled country, per brand', () => {
    const products = [
      product({ sku: 'GC-APPLE-US-25' }),
      product({ sku: 'GC-APPLE-US-50' }),
      product({ sku: 'GC-PSN-US-10', category: { slug: 'playstation' } }),
      product({ sku: 'GC-STEAM-10' }),
    ];
    const rules = [
      { countryCode: 'MR', scope: 'brand', ref: 'gc-apple-us' },
      { countryCode: 'ML', scope: 'product', ref: 'GC-APPLE-US-25' },
      { countryCode: 'MR', scope: 'category', ref: 'playstation' },
      { countryCode: 'ML', scope: 'category', ref: 'playstation' },
    ];
    const found = regionLockedFindings(products, [ML, MR], rules);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ fingerprint: 'catalog.region-locked:gc-apple-us', verified: false });
    expect(found[0].description).toContain('GC-APPLE-US-50');
    expect(found[0].description).not.toContain('GC-APPLE-US-25');
    expect(regionLockedFindings(products, [], rules)).toEqual([]);
  });

  it('the scanner reads active products, enabled countries and rules, and asks pricing for a rate', async () => {
    const prisma: any = {
      product: { findMany: jest.fn().mockResolvedValue([product({ sku: 'GC-APPLE-US-25' })]) },
      marketCountry: { findMany: jest.fn().mockResolvedValue([ML, MR]) },
      productMarketRule: { findMany: jest.fn().mockResolvedValue([]) },
      currency: { findMany: jest.fn().mockResolvedValue([{ code: 'XOF', isActive: true }, { code: 'MRU', isActive: true }]) },
    };
    const pricing: any = {
      getRate: jest.fn((c: string) => (c === 'XOF' ? Promise.reject(new NotFoundException()) : Promise.resolve({ id: null, rate: 1 }))),
    };
    const found = await new CatalogReadinessScanner(prisma, pricing).scan();
    expect(found.map((f) => f.fingerprint).sort()).toEqual(['catalog.no-price:XOF', 'catalog.region-locked:gc-apple-us']);
    expect(prisma.product.findMany.mock.calls[0][0].where).toEqual({ deletedAt: null, isActive: true });
  });
});

describe('payments-by-country rules', () => {
  const account = (over: Partial<ManualAccount> = {}): ManualAccount => ({
    id: randomUUID().slice(0, 8), method: 'Bankily', countries: ['MR'], accountName: 'Owner Name', accountNumber: fakeNumber(),
    kind: 'mobile', enabled: true, instructions: `call ${fakeNumber()}`, ...over,
  });
  const countries = [{ code: 'MR', nameAr: 'موريتانيا' }, { code: 'ML', nameAr: 'مالي' }, { code: 'DZ', nameAr: 'الجزائر' }];

  it('reports each case, and never an account number, holder name or instructions', () => {
    const accounts = [
      account({ method: 'Masrvi' }),
      account({ id: 'everyone', method: 'Wave', countries: [] }),
      account({ id: 'no-number', method: 'Moov Money', countries: ['DZ'], accountNumber: '  ' }),
      account({ id: 'linked', method: 'Orange Money', countries: ['ML'], enabled: false }),
    ];
    const methods = [
      { id: 'm1', countryCode: 'ML', key: 'orange-money-ml', name: 'Orange Money Mali', accountId: 'linked' },
      { id: 'm2', countryCode: 'ML', key: 'moov-ml', name: 'Moov Mali', accountId: 'gone' },
      { id: 'm3', countryCode: 'ML', key: 'wave-ml', name: 'Wave Mali', accountId: null },
      { id: 'm4', countryCode: 'MR', key: 'masrvi', name: 'Masrvi', accountId: accounts[0].id },
      { id: 'm5', countryCode: 'ML', key: 'masrvi-ml', name: 'Masrvi ML', accountId: accounts[0].id },
    ];
    const found = paymentFindings(accounts, countries, methods);
    const fps = found.map((f) => f.fingerprint).sort();
    expect(fps).toEqual([
      'market.method-account-unusable:m1',
      'market.method-account-unusable:m2',
      'market.method-account-unusable:m3',
      'market.method-account-unusable:m5',
      'payments.account-all-countries:everyone',
      'payments.account-no-number:no-number',
      'payments.country-uncovered:DZ',
      'payments.country-uncovered:ML',
    ]);
    // ML and DZ are reached only through the "every country" account: MEDIUM, not HIGH
    expect(found.find((f) => f.fingerprint.endsWith(':ML'))!.severity).toBe('MEDIUM');
    const text = JSON.stringify(found);
    for (const a of accounts) {
      if (a.accountNumber.trim()) expect(text).not.toContain(a.accountNumber);
      expect(text).not.toContain(a.instructions!.split(' ')[1]);
    }
    expect(text).not.toContain('Owner Name');
  });

  it('an enabled country with no usable account at all is HIGH; a fully set-up shop has nothing to report', () => {
    expect(paymentFindings([], [countries[0]], [])[0]).toMatchObject({ severity: 'HIGH' });
    expect(paymentFindings([account()], [countries[0]], [{ id: 'm', countryCode: 'MR', key: 'k', name: 'n', accountId: null }])
      .map((f) => f.fingerprint)).toEqual(['market.method-account-unusable:m']);
    const ok = account();
    expect(paymentFindings([ok], [countries[0]], [{ id: 'm', countryCode: 'MR', key: 'k', name: 'n', accountId: ok.id }])).toEqual([]);
  });

  it('a disabled account without countries is LOW; a disabled one without a number is fine', () => {
    const found = paymentFindings([account({ id: 'x', countries: [], enabled: false, accountNumber: '' })], [], []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ fingerprint: 'payments.account-all-countries:x', severity: 'LOW' });
  });

  it('the scanner reads the accounts through the manual gateway', async () => {
    const prisma: any = {
      marketCountry: { findMany: jest.fn().mockResolvedValue([countries[0]]) },
      marketPaymentMethod: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const gateway: any = { accounts: jest.fn().mockResolvedValue([account()]) };
    expect(await new PaymentsByCountryScanner(prisma, gateway).scan()).toEqual([]);
    expect(prisma.marketPaymentMethod.findMany.mock.calls[0][0].where).toEqual({ status: 'ACTIVE' });
  });
});

describe('market-staleness rules', () => {
  const old = new Date(NOW.getTime() - 120 * DAY);

  it('reads the threshold setting, falling back to 90 days', () => {
    expect(staleDays(30)).toBe(30);
    expect(staleDays('45')).toBe(45);
    expect(staleDays(0)).toBe(DEFAULT_STALE_DAYS);
    expect(staleDays('x')).toBe(DEFAULT_STALE_DAYS);
    expect(staleDays(undefined)).toBe(DEFAULT_STALE_DAYS);
  });

  it('one finding per country with stale items, and one per enabled country never researched', () => {
    const found = stalenessFindings(
      [
        { code: 'ML', nameAr: 'مالي', enabled: true, lastResearchedAt: old },
        { code: 'NE', nameAr: 'النيجر', enabled: true, lastResearchedAt: null },
        { code: 'SN', nameAr: 'السنغال', enabled: false, lastResearchedAt: null },
      ],
      [
        { countryCode: 'ML', label: 'Orange Money', status: 'ACTIVE', lastVerifiedAt: old },
        { countryCode: 'SN', label: 'Wave', status: 'PENDING_REVIEW', lastVerifiedAt: old },
      ],
      [{ countryCode: 'ML', label: 'brand:gc-apple-us', status: 'APPROVED', lastVerifiedAt: new Date(old.getTime() - DAY) }],
      90,
    );
    expect(found.map((f) => f.fingerprint)).toEqual(['market.stale:ML', 'market.research-needed:NE', 'market.stale:SN']);
    expect(found[0]).toMatchObject({ severity: 'MEDIUM', kind: 'market' });
    expect(found[0].description).toContain('2026-06-21');
    expect(found[2].severity).toBe('LOW');
  });

  it('the scanner queries items older than the threshold, rejected ones excluded', async () => {
    const prisma: any = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: 30 }) },
      marketCountry: { findMany: jest.fn().mockResolvedValue([{ code: 'ML', nameAr: 'مالي', enabled: true, lastResearchedAt: NOW }]) },
      marketPaymentMethod: { findMany: jest.fn().mockResolvedValue([{ countryCode: 'ML', name: 'Orange', status: 'APPROVED', lastVerifiedAt: old }]) },
      productMarketRule: { findMany: jest.fn().mockResolvedValue([{ countryCode: 'ML', scope: 'brand', ref: 'x', status: 'APPROVED', lastVerifiedAt: old }]) },
    };
    const found = await new MarketStalenessScanner(prisma).scan(NOW);
    expect(found.map((f) => f.fingerprint)).toEqual(['market.stale:ML']);
    expect(prisma.marketPaymentMethod.findMany.mock.calls[0][0].where).toEqual({
      status: { not: 'REJECTED' }, lastVerifiedAt: { lt: new Date(NOW.getTime() - 30 * DAY) },
    });
  });
});

describe('server-errors rules', () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  it('groups repeated errors by the notices fingerprint and ignores rare ones', () => {
    const rows = [
      ...[1, 2, 3].map((h) => ({ value: `Order ${randomUUID()} failed with 42`, path: `/api/v1/orders/${randomUUID()}`, createdAt: at(h) })),
      { value: 'Something odd', path: '/api/v1/x', createdAt: at(1) },
    ];
    const found = serverErrorFindings(rows, []);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: 'bug', severity: 'LOW', verified: true });
    expect(found[0].fingerprint).toBe(`server-error:${errorFingerprint(rows[0].value, rows[0].path)}`);
    expect(found[0].evidence[1]).toEqual({ type: 'url', ref: '/api/v1/orders/:id' });
    expect(found[0].evidence[0].detail).toContain(at(1).toISOString());
  });

  it('takes the count from an open system.error notice and adds notice-only errors', () => {
    const fp = errorFingerprint('Boom', '/api/v1/a');
    const found = serverErrorFindings(
      [{ value: 'Boom', path: '/api/v1/a', createdAt: at(1) }],
      [
        { entityId: fp, body: 'GET /api/v1/a — Boom', data: { count: 12 }, updatedAt: at(1) },
        { entityId: 'abc', body: 'POST /api/v1/payments — Duplicate payment for order', data: { count: 3 }, updatedAt: at(2) },
        { entityId: 'rare', body: 'GET /x — rare', data: null, updatedAt: at(2) },
        { entityId: null, body: 'x', data: { count: 99 }, updatedAt: at(2) },
      ],
    );
    expect(found.map((f) => [f.fingerprint, f.severity])).toEqual([[`server-error:${fp}`, 'MEDIUM'], ['server-error:abc', 'HIGH']]);
    expect(found[1].evidence[0].ref).toBe('staff_notifications:system.error');
    expect(found[1].impact).toContain('استرجاع');
  });

  it('50 or more is HIGH', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ value: 'Crash', path: null, createdAt: at(i % 24) }));
    const found = serverErrorFindings(rows, []);
    expect(found[0].severity).toBe('HIGH');
    expect(found[0].evidence).toHaveLength(1);
  });

  it('the scanner reads the last 7 days of stored errors and open notices', async () => {
    const prisma: any = {
      storeEvent: { findMany: jest.fn().mockResolvedValue([]) },
      staffNotification: { findMany: jest.fn().mockResolvedValue([]) },
    };
    expect(await new ServerErrorsScanner(prisma).scan(NOW)).toEqual([]);
    expect(prisma.storeEvent.findMany.mock.calls[0][0].where).toEqual({ kind: 'server_error', createdAt: { gte: new Date(NOW.getTime() - 7 * DAY) } });
    expect(prisma.staffNotification.findMany.mock.calls[0][0].where).toMatchObject({ type: 'system.error', resolvedAt: null });
  });
});

describe('search-gaps rules', () => {
  it('turns repeated empty searches into opportunities and skips personal data', () => {
    const found = searchGapFindings([
      { query: 'roblox 800', count: 25, lastAt: NOW },
      { query: 'valorant', count: 3, lastAt: NOW },
      { query: 'rare', count: 2, lastAt: NOW },
      { query: `+222${fakeNumber()}`, count: 9, lastAt: NOW },
      { query: 'someone@example.com', count: 9, lastAt: NOW },
      { query: 'x', count: 9, lastAt: NOW },
    ]);
    expect(found.map((f) => f.title)).toEqual(['بحث بلا نتائج: «roblox 800»', 'بحث بلا نتائج: «valorant»']);
    expect(found[0]).toMatchObject({ kind: 'opportunity', severity: 'MEDIUM', confidence: 90 });
    expect(found[1]).toMatchObject({ severity: 'LOW', confidence: 46 });
    expect(found[0].fingerprint).toMatch(/^search-gap:[0-9a-f]{16}$/);
    expect(searchGapFindings([{ query: 'valorant', count: 4, lastAt: NOW }])[0].fingerprint).toBe(found[1].fingerprint);
  });

  it('the scanner groups search misses in SQL', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([{ query: 'netflix tr', count: 4, lastAt: NOW }]) };
    expect(await new SearchGapsScanner(prisma).scan(NOW)).toHaveLength(1);
  });
});

describe('ScannersService', () => {
  const scanner = (name: string, impl: () => Promise<unknown[]>) => ({ name, scan: jest.fn(impl) });

  function build(scanners: any[]) {
    const prisma: any = {
      agentRun: { create: jest.fn((a: any) => Promise.resolve({ id: randomUUID(), ...a.data })) },
      discovery: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const store: any = {
      upsert: jest.fn((d: any) => Promise.resolve({ created: d.fingerprint.endsWith('new'), discovery: { id: randomUUID() } })),
    };
    const service = new ScannersService(prisma, store, ...(scanners as [any, any, any, any, any]));
    return { prisma, store, service };
  }

  it('one failing scanner does not stop the others; every scanner records its own run', async () => {
    const finding = (fingerprint: string) => ({ fingerprint });
    const { prisma, store, service } = build([
      scanner('catalog-readiness', () => Promise.resolve([finding('a:new'), finding('b:old')])),
      scanner('payments-by-country', () => Promise.reject(new Error(`boom token=${randomUUID()}`))),
      scanner('market-staleness', () => Promise.resolve([])),
      scanner('server-errors', () => Promise.resolve([finding('c:new')])),
      scanner('search-gaps', () => Promise.resolve([])),
    ]);
    const res = await service.runAll('manual', NOW);

    expect(res).toMatchObject({ created: 2, updated: 1 });
    expect(store.upsert).toHaveBeenCalledWith(finding('a:new'), 'scanner:catalog-readiness', NOW);
    const runs = prisma.agentRun.create.mock.calls.map((c: any) => c[0].data);
    expect(runs.map((r: any) => [r.agent, r.trigger, r.status])).toEqual([
      ['scanner:catalog-readiness', 'app', 'SUCCEEDED'],
      ['scanner:payments-by-country', 'app', 'FAILED'],
      ['scanner:market-staleness', 'app', 'SUCCEEDED'],
      ['scanner:server-errors', 'app', 'SUCCEEDED'],
      ['scanner:search-gaps', 'app', 'SUCCEEDED'],
      ['scanners', 'manual', 'FAILED'],
    ]);
    expect(runs[0]).toMatchObject({ discoveries: 2, startedAt: expect.any(Date), finishedAt: expect.any(Date) });
    expect(runs[1].summary).toContain('token=[redacted]');
    expect(runs[2].summary).toBe('لا شيء يحتاج انتباهًا');
    expect(runs[5]).toMatchObject({ discoveries: 3, details: expect.objectContaining({ wokenFromDeferral: 2 }) });
    expect(prisma.discovery.updateMany).toHaveBeenCalledWith({
      where: { status: 'DEFERRED', deferredUntil: { lte: NOW } },
      data: { status: 'PENDING_REVIEW', deferredUntil: null },
    });
  });

  it('all scanners fine: the pass succeeds; a failed run record never throws', async () => {
    const { prisma, service } = build(['catalog-readiness', 'payments-by-country', 'market-staleness', 'server-errors', 'search-gaps']
      .map((n) => scanner(n, () => Promise.resolve([]))));
    expect((await service.runAll('schedule', NOW)).run.status).toBe('SUCCEEDED');

    prisma.agentRun.create.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('db down'));
    const r = await service.runOne(scanner('search-gaps', () => Promise.resolve([])) as any, NOW);
    expect(r).toMatchObject({ status: 'FAILED', error: 'db down' });
  });
});
