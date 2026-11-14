import { randomBytes, randomUUID } from 'crypto';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  INGEST_TOKEN_HEADER, IngestRequest, IntelIngestGuard, tokenMatches,
} from '../../src/modules/intelligence/ingest.guard';
import {
  DiscoveriesQueryDto, DiscoveryDecisionDto, IngestDto, MAX_INGEST_DISCOVERIES,
} from '../../src/modules/intelligence/dto/intelligence.dto';

const ctx = (req: IngestRequest) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;
const errorOf = (e: unknown) => (e as ForbiddenException).getResponse() as { error?: string };

describe('IntelIngestGuard', () => {
  const saved = process.env.INTEL_INGEST_TOKEN;
  const token = randomBytes(24).toString('hex');
  let guard: IntelIngestGuard;
  let parent: jest.SpyInstance;

  beforeEach(() => {
    guard = new IntelIngestGuard();
    parent = jest.spyOn(Object.getPrototypeOf(IntelIngestGuard.prototype), 'canActivate');
  });
  afterEach(() => {
    parent.mockRestore();
    if (saved === undefined) delete process.env.INTEL_INGEST_TOKEN;
    else process.env.INTEL_INGEST_TOKEN = saved;
  });

  it('no env: 403 INGEST_DISABLED, with or without a token', async () => {
    delete process.env.INTEL_INGEST_TOKEN;
    for (const headers of [{ [INGEST_TOKEN_HEADER]: token }, {}]) {
      const err = await guard.canActivate(ctx({ headers })).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(errorOf(err).error).toBe('INGEST_DISABLED');
    }
  });

  it('a configured token shorter than 16 characters keeps the route off', async () => {
    process.env.INTEL_INGEST_TOKEN = 'short';
    const err = await guard.canActivate(ctx({ headers: { [INGEST_TOKEN_HEADER]: 'short' } })).catch((e) => e);
    expect(errorOf(err).error).toBe('INGEST_DISABLED');
  });

  it('wrong or missing token: 401', async () => {
    process.env.INTEL_INGEST_TOKEN = token;
    for (const headers of [{ [INGEST_TOKEN_HEADER]: `${token}x` }, { [INGEST_TOKEN_HEADER]: token.slice(1) }, {}]) {
      const err = await guard.canActivate(ctx({ headers })).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(errorOf(err).error).toBe('INVALID_INGEST_TOKEN');
    }
  });

  it('right token: allowed, as the token actor (a bearer header does not change that)', async () => {
    process.env.INTEL_INGEST_TOKEN = ` ${token} `;
    const req: IngestRequest = { headers: { [INGEST_TOKEN_HEADER]: [token], authorization: 'Bearer x.y.z' } };
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.intelActor).toEqual({ label: 'ingest-token', via: 'token' });
    expect(parent).not.toHaveBeenCalled();
  });

  it('a staff session needs intelligence.decide (super_admin bypasses)', async () => {
    delete process.env.INTEL_INGEST_TOKEN;
    const id = randomUUID();
    const as = (roles: string[], permissions: string[]) => {
      parent.mockImplementation(function (this: unknown, c: any) {
        c.switchToHttp().getRequest().user = { id, email: null, roles, permissions };
        return Promise.resolve(true);
      });
      return { headers: { authorization: 'Bearer a.b.c' } } as IngestRequest;
    };

    const decider = as(['admin'], ['intelligence.read', 'intelligence.decide']);
    await expect(guard.canActivate(ctx(decider))).resolves.toBe(true);
    expect(decider.intelActor).toEqual({ id, label: id, via: 'staff' });

    await expect(guard.canActivate(ctx(as(['super_admin'], [])))).resolves.toBe(true);

    const reader = as(['support'], ['intelligence.read']);
    await expect(guard.canActivate(ctx(reader))).rejects.toBeInstanceOf(ForbiddenException);

    parent.mockResolvedValue(true); // the strategy let it through but no user was set
    await expect(guard.canActivate(ctx({ headers: { authorization: 'Bearer a.b.c' } }))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('compares tokens in constant time, whatever their length', () => {
    expect(tokenMatches(token, token)).toBe(true);
    expect(tokenMatches(token.slice(0, -1), token)).toBe(false);
    expect(tokenMatches(`${token}0`, token)).toBe(false);
    expect(tokenMatches('', token)).toBe(false);
  });
});

describe('intelligence DTOs', () => {
  const discovery = (over: Record<string, unknown> = {}) => ({
    fingerprint: 'bug:checkout-500', kind: 'Bug', title: ' t ', description: 'd', evidence: [{ type: 'code', ref: 'src/a.ts:10' }],
    confidence: 60, verified: false, severity: 'high', impact: 'i', proposal: 'p', ...over,
  });
  const errorsOf = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body) as object, { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  it('accepts a full ingest and normalises case', async () => {
    const body = plainToInstance(IngestDto, {
      agent: 'QA-Tester', trigger: 'CI', status: 'ok', summary: 's', commit: 'ABCDEF1', branch: 'claude/x',
      tests: { passed: 1, failed: 0 }, discoveries: [discovery({ testResults: { a: 1 }, prUrl: 'https://github.com/o/r/pull/1' })],
      market: {
        code: 'ml',
        methods: [{ key: 'Orange-Money-ML', name: 'Orange Money', kind: 'mobile_money', currency: 'xof', sources: [{ url: 'https://orange.ml', title: 'Orange', accessedAt: '2026-10-19' }], confidence: 90, verifiedBy: 'market-scout' }],
        rules: [{ scope: 'brand', ref: 'gc-apple-us', availability: 'REGION_ACCOUNT_REQUIRED', sources: [], confidence: 50, verifiedBy: 'market-scout' }],
      },
    });
    expect(await validate(body, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(body).toMatchObject({ agent: 'qa-tester', trigger: 'ci', status: 'SUCCEEDED', commit: 'abcdef1' });
    expect(body.discoveries![0]).toMatchObject({ kind: 'bug', severity: 'HIGH', title: 't' });
    expect(body.market).toMatchObject({ code: 'ML', methods: [expect.objectContaining({ key: 'orange-money-ml', currency: 'XOF' })] });
  });

  it(`caps discoveries at ${MAX_INGEST_DISCOVERIES} and string lengths`, async () => {
    const base = { agent: 'a', trigger: 'ci', status: 'SUCCEEDED' };
    expect(await errorsOf(IngestDto, { ...base, discoveries: Array.from({ length: MAX_INGEST_DISCOVERIES + 1 }, () => discovery()) })).toEqual(['discoveries']);
    expect(await errorsOf(IngestDto, { ...base, summary: 'x'.repeat(2001) })).toEqual(['summary']);
    expect(await errorsOf(IngestDto, { ...base, discoveries: [discovery({ title: 'x'.repeat(201) })] })).toEqual(['discoveries']);
    expect(await errorsOf(IngestDto, { ...base, discoveries: [discovery({ testResults: { blob: 'x'.repeat(5000) } })] })).toEqual(['discoveries']);
  });

  it('rejects unknown kinds, statuses, fingerprints, fields and non-https PR links', async () => {
    const base = { agent: 'a', trigger: 'ci', status: 'SUCCEEDED' };
    expect(await errorsOf(IngestDto, { ...base, status: 'DONE' })).toEqual(['status']);
    expect(await errorsOf(IngestDto, { ...base, trigger: 'cron' })).toEqual(['trigger']);
    expect(await errorsOf(IngestDto, { ...base, agent: 'Bad Agent!' })).toEqual(['agent']);
    expect(await errorsOf(IngestDto, { ...base, extra: 1 })).toEqual(['extra']);
    for (const bad of [{ kind: 'gossip' }, { fingerprint: 'has space' }, { prUrl: 'http://x.test/pr' }, { confidence: 101 }, { evidence: [{ type: 'rumour', ref: 'x' }] }]) {
      expect(await errorsOf(IngestDto, { ...base, discoveries: [discovery(bad)] })).toEqual(['discoveries']);
    }
  });

  it('decision and list queries', async () => {
    expect(await errorsOf(DiscoveryDecisionDto, { action: 'defer', deferDays: 30, note: 'later' })).toEqual([]);
    expect(await errorsOf(DiscoveryDecisionDto, { action: 'delete' })).toEqual(['action']);
    expect(await errorsOf(DiscoveryDecisionDto, { action: 'defer', deferDays: 0 })).toEqual(['deferDays']);
    expect(await errorsOf(DiscoveriesQueryDto, { tab: 'critical', limit: '20', severity: 'HIGH', kind: 'payment' })).toEqual([]);
    expect(await errorsOf(DiscoveriesQueryDto, { tab: 'urgent' })).toEqual(['tab']);
  });
});
