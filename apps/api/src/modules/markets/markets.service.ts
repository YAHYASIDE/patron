import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { MarketCountry, MarketReviewStatus, Prisma } from '@prisma/client';

import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  MANUAL_ACCOUNTS_KEY, ManualAccount, OTHER_COUNTRIES, isUsable, normalizeAccount,
} from '../payments/gateways/manual.gateway';
import { CreateMarketDto, UpdateMarketDto } from './dto/markets.dto';
import {
  AVAILABILITIES, DEFAULT_STALE_DAYS, METHOD_KINDS, MarketActor, MarketDecisionAction, MarketMethodInput,
  MarketRuleInput, MarketSource, RULE_SCOPES, STALE_DAYS_KEY,
} from './markets.types';

const DAY_MS = 86_400_000;

const marketNotFound = () => new NotFoundException({ message: 'Unknown country', error: 'MARKET_NOT_FOUND' });
const methodNotFound = () => new NotFoundException({ message: 'Payment method not found', error: 'MARKET_METHOD_NOT_FOUND' });
const ruleNotFound = () => new NotFoundException({ message: 'Product rule not found', error: 'MARKET_RULE_NOT_FOUND' });
const invalidItem = (index: number, message: string) =>
  new BadRequestException({ message: `Item ${index + 1}: ${message}`, error: 'INVALID_MARKET_ITEM', index });

/** The fingerprint of the "research this new country" discovery. */
export const researchFingerprint = (code: string) => `market.research-needed:${code}`;

/** What the owner may see of a receiving number: never the whole of it. */
export function maskNumber(value: string): string {
  const s = value.replace(/\s+/g, '');
  if (!s) return '';
  return s.length <= 4 ? '••••' : `••••${s.slice(-3)}`;
}

/** An account's view for a market: the number masked, never in full. */
export function accountView(a: ManualAccount) {
  return {
    id: a.id, method: a.method, kind: a.kind, countries: a.countries, enabled: a.enabled, usable: isUsable(a),
    number: maskNumber(a.accountNumber),
  };
}

/**
 * Accounts that list this country by name. An account with no `countries` is offered everywhere
 * (legacy, reported by the payments scanner) and is deliberately not a candidate here: a market
 * method is only ever linked to an account the owner pointed at that country.
 */
export const accountsListing = (accounts: ManualAccount[], code: string) =>
  accounts.filter((a) => a.countries.includes(code));

const isP2002 = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
const unique = <T>(values: T[]) => [...new Set(values)];
const json = (v: unknown) => v as Prisma.InputJsonValue;

const cleanText = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optionalText = (v: unknown, max: number) => cleanText(v, max) || null;

function cleanSources(raw: unknown, index: number): MarketSource[] {
  if (!Array.isArray(raw) || !raw.length) throw invalidItem(index, 'at least one source is required');
  return raw.slice(0, 10).map((s: Partial<MarketSource>) => {
    const url = cleanText(s?.url, 500);
    if (!/^https?:\/\/\S+$/i.test(url)) throw invalidItem(index, 'every source needs an http(s) url');
    return {
      url,
      title: cleanText(s.title, 200) || url,
      ...(cleanText(s.publisher, 120) && { publisher: cleanText(s.publisher, 120) }),
      accessedAt: cleanText(s.accessedAt, 40) || new Date().toISOString(),
    };
  });
}

const cleanConfidence = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
};

/**
 * Countries the shop serves or studies, the payment methods research found in
 * each, and whether a product works there.
 *
 * Knowledge only. Nothing here creates, enables or edits a payment account, and
 * nothing is approved or activated without a person: research lands as
 * PENDING_REVIEW, a re-research keeps the owner's decision, and a method becomes
 * ACTIVE only when the owner links it to a usable account of their own that
 * already lists the country.
 */
@Injectable()
export class MarketsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ── settings and helpers ──

  /** `markets.stale_days` (default 90): older facts need checking again. */
  async staleDays(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: STALE_DAYS_KEY } });
    const n = Number(row?.value);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_STALE_DAYS;
  }

  /** Anything verified before this moment is stale. */
  async staleCutoff(now = new Date()): Promise<Date> {
    return new Date(now.getTime() - (await this.staleDays()) * DAY_MS);
  }

  /** The owner's manual accounts, read the way the manual gateway reads them. */
  async manualAccounts(): Promise<ManualAccount[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: MANUAL_ACCOUNTS_KEY } });
    return Array.isArray(row?.value) ? (row.value as unknown as ManualAccount[]).map(normalizeAccount) : [];
  }

  private async country(code: string): Promise<MarketCountry> {
    const c = /^[A-Za-z]{2}$/.test(code)
      ? await this.prisma.marketCountry.findUnique({ where: { code: code.toUpperCase() } })
      : null;
    if (!c) throw marketNotFound();
    return c;
  }

  // ── public ──

  /** The countries the store offers. */
  publicList() {
    return this.prisma.marketCountry.findMany({
      where: { enabled: true },
      orderBy: { code: 'asc' },
      select: {
        code: true, nameAr: true, nameFr: true, nameEn: true, currency: true, currencies: true, languages: true, dialCode: true,
      },
    });
  }

  /** Approved product rules of an enabled country (a disabled one is not a market yet). */
  async publicRules(code: string) {
    const c = await this.country(code);
    if (!c.enabled) throw marketNotFound();
    return this.prisma.productMarketRule.findMany({
      where: { countryCode: c.code, status: 'APPROVED' },
      orderBy: [{ scope: 'asc' }, { ref: 'asc' }],
      select: { scope: true, ref: true, availability: true, note: true },
    });
  }

  // ── staff: countries ──

  async list() {
    const cutoff = await this.staleCutoff();
    const notRejected = { status: { not: MarketReviewStatus.REJECTED }, lastVerifiedAt: { lt: cutoff } };
    const [countries, methods, rules, staleMethods, staleRules] = await Promise.all([
      this.prisma.marketCountry.findMany({ orderBy: [{ enabled: 'desc' }, { code: 'asc' }] }),
      this.prisma.marketPaymentMethod.groupBy({ by: ['countryCode', 'status'], _count: { _all: true } }),
      this.prisma.productMarketRule.groupBy({ by: ['countryCode', 'status'], _count: { _all: true } }),
      this.prisma.marketPaymentMethod.groupBy({ by: ['countryCode'], where: notRejected, _count: { _all: true } }),
      this.prisma.productMarketRule.groupBy({ by: ['countryCode'], where: notRejected, _count: { _all: true } }),
    ]);
    const count = (rows: Array<{ countryCode: string; status?: string; _count: { _all: number } }>, code: string, status?: string) =>
      rows.filter((r) => r.countryCode === code && (!status || r.status === status)).reduce((n, r) => n + r._count._all, 0);
    return countries.map((c) => ({
      ...c,
      methods: {
        pending: count(methods, c.code, 'PENDING_REVIEW'),
        approved: count(methods, c.code, 'APPROVED'),
        active: count(methods, c.code, 'ACTIVE'),
        rejected: count(methods, c.code, 'REJECTED'),
        deferred: count(methods, c.code, 'DEFERRED'),
      },
      rules: {
        pending: count(rules, c.code, 'PENDING_REVIEW'),
        approved: count(rules, c.code, 'APPROVED'),
        rejected: count(rules, c.code, 'REJECTED'),
        deferred: count(rules, c.code, 'DEFERRED'),
      },
      stale: count(staleMethods, c.code) + count(staleRules, c.code),
    }));
  }

  async detail(code: string) {
    const country = await this.country(code);
    const [cutoff, methods, rules, accounts] = await Promise.all([
      this.staleCutoff(),
      this.prisma.marketPaymentMethod.findMany({ where: { countryCode: country.code }, orderBy: [{ status: 'asc' }, { name: 'asc' }] }),
      this.prisma.productMarketRule.findMany({ where: { countryCode: country.code }, orderBy: [{ status: 'asc' }, { scope: 'asc' }, { ref: 'asc' }] }),
      this.manualAccounts(),
    ]);
    const stale = (r: { status: MarketReviewStatus; lastVerifiedAt: Date }) => r.status !== 'REJECTED' && r.lastVerifiedAt < cutoff;
    return {
      country,
      methods: methods.map((m) => ({ ...m, stale: stale(m) })),
      rules: rules.map((r) => ({ ...r, stale: stale(r) })),
      accounts: accountsListing(accounts, country.code).map(accountView),
    };
  }

  /** A new country starts switched off, with a discovery asking for its research. */
  async create(dto: CreateMarketDto, actorId: string) {
    const code = dto.code.toUpperCase();
    if (code === OTHER_COUNTRIES) {
      throw new BadRequestException({ message: `${OTHER_COUNTRIES} means "every other country" and is not a market`, error: 'MARKET_CODE_RESERVED' });
    }
    const conflict = () => new ConflictException({ message: 'This country already exists', error: 'MARKET_EXISTS' });
    if (await this.prisma.marketCountry.findUnique({ where: { code } })) throw conflict();

    const data = {
      code, nameAr: dto.nameAr, nameFr: dto.nameFr, nameEn: dto.nameEn,
      currency: dto.currency, currencies: unique([dto.currency, ...(dto.currencies ?? [])]),
      languages: unique(dto.languages ?? []), dialCode: dto.dialCode, notes: dto.notes ?? null, enabled: false,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        const country = await tx.marketCountry.create({ data });
        await this.raiseResearchNeeded(tx, country);
        await this.audit.record(tx, { actorId, action: 'markets.country.create', entityType: 'MarketCountry', entityId: code, after: country });
        return country;
      });
    } catch (e) {
      if (isP2002(e)) throw conflict();
      throw e;
    }
  }

  /**
   * Upsert the discovery by fingerprint: created once, then only seen again. A DONE or REJECTED
   * one is never reopened; it is flagged as reappeared and a person decides.
   */
  private async raiseResearchNeeded(tx: Prisma.TransactionClient, c: MarketCountry) {
    const now = new Date();
    const row = await tx.discovery.upsert({
      where: { fingerprint: researchFingerprint(c.code) },
      update: { seenCount: { increment: 1 }, lastSeenAt: now },
      create: {
        fingerprint: researchFingerprint(c.code),
        kind: 'market',
        title: `بحث مطلوب لسوق ${c.nameAr} (${c.code})`,
        description: `أُضيفت ${c.nameAr} إلى الأسواق وهي متوقفة. لم تُبحث بعدُ وسائل الدفع فيها ولا توفّر المنتجات.`,
        evidence: json([{ type: 'db', ref: `market_countries/${c.code}`, detail: 'country added, disabled, never researched' }]),
        confidence: 100,
        verified: true,
        severity: 'MEDIUM',
        impact: `لا يمكن فتح ${c.nameAr} للزبائن قبل معرفة وسائل الدفع المحلية الموثوقة وتوفّر المنتجات فيها.`,
        proposal:
          `ابحث في وسائل الدفع المحلية (العملة ${c.currency}، رمز الاتصال +${c.dialCode}) وفي توفّر المنتجات من مصادر رسمية، ` +
          'وسجّلها اقتراحاتٍ بانتظار المراجعة. لا يُفعَّل شيء تلقائيًا.',
        source: 'markets',
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });
    if (row.seenCount > 1 && (row.status === 'DONE' || row.status === 'REJECTED')) {
      const previous = row.testResults && typeof row.testResults === 'object' && !Array.isArray(row.testResults) ? row.testResults : {};
      await tx.discovery.update({
        where: { id: row.id },
        data: { testResults: json({ ...previous, reappeared: true, reappearedAt: now.toISOString() }) },
      });
    }
  }

  async update(code: string, dto: UpdateMarketDto, actorId: string) {
    const before = await this.country(code);
    const currency = dto.currency ?? before.currency;
    const data: Prisma.MarketCountryUpdateInput = {
      ...(dto.nameAr !== undefined && { nameAr: dto.nameAr }),
      ...(dto.nameFr !== undefined && { nameFr: dto.nameFr }),
      ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
      ...(dto.dialCode !== undefined && { dialCode: dto.dialCode }),
      ...(dto.notes !== undefined && { notes: dto.notes || null }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.languages !== undefined && { languages: unique(dto.languages) }),
      // the paying currency is always the first accepted one
      ...((dto.currency !== undefined || dto.currencies !== undefined) && {
        currency,
        currencies: unique([currency, ...(dto.currencies ?? before.currencies)]),
      }),
    };
    const action = dto.enabled === undefined || dto.enabled === before.enabled
      ? 'markets.country.update'
      : dto.enabled ? 'markets.country.enable' : 'markets.country.disable';
    const snapshot = { ...before };
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.marketCountry.update({ where: { code: before.code }, data });
      await this.audit.record(tx, { actorId, action, entityType: 'MarketCountry', entityId: before.code, before: snapshot, after });
      return after;
    });
  }

  // ── research: methods and rules ──

  /**
   * Record what research found, by (country, key). A new method waits for review; an existing one
   * keeps its status, decision and linked account, and only its facts, sources and verification
   * date are refreshed. Research can never approve or activate anything.
   */
  async upsertMethods(code: string, items: MarketMethodInput[], actor: MarketActor): Promise<{ created: number; updated: number }> {
    const country = await this.country(code);
    const byKey = new Map<string, ReturnType<typeof cleanMethod>>();
    items.forEach((item, i) => {
      const m = cleanMethod(item, i, actor);
      byKey.set(m.key, m);
    });
    const list = [...byKey.values()];
    if (!list.length) return { created: 0, updated: 0 };

    return this.retryOnConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockResearch(tx, country.code);
        const now = new Date();
        const existing = new Set(
          (await tx.marketPaymentMethod.findMany({ where: { countryCode: country.code, key: { in: list.map((m) => m.key) } }, select: { key: true } }))
            .map((r) => r.key),
        );
        for (const m of list) {
          const facts = {
            name: m.name, provider: m.provider, kind: m.kind, currency: m.currency, fees: m.fees, note: m.note,
            sources: json(m.sources), confidence: m.confidence, verifiedBy: m.verifiedBy, lastVerifiedAt: now,
          };
          await tx.marketPaymentMethod.upsert({
            where: { countryCode_key: { countryCode: country.code, key: m.key } },
            update: facts,
            create: { countryCode: country.code, key: m.key, status: 'PENDING_REVIEW', ...facts },
          });
        }
        await tx.marketCountry.update({ where: { code: country.code }, data: { lastResearchedAt: now } });
        const result = { created: list.filter((m) => !existing.has(m.key)).length, updated: list.filter((m) => existing.has(m.key)).length };
        await this.audit.record(tx, {
          actorId: actor.id, action: 'markets.methods.upsert', entityType: 'MarketCountry', entityId: country.code,
          after: { by: actor.label, keys: list.map((m) => m.key), ...result },
        });
        return result;
      }),
    );
  }

  /**
   * Same as methods, by (country, scope, ref). One difference: the store shows an approved rule, so
   * when research reports a different availability for a rule someone already decided, the rule goes
   * back to PENDING_REVIEW instead of changing what customers see without a person.
   */
  async upsertRules(code: string, items: MarketRuleInput[], actor: MarketActor): Promise<{ created: number; updated: number }> {
    const country = await this.country(code);
    const byRef = new Map<string, ReturnType<typeof cleanRule>>();
    items.forEach((item, i) => {
      const r = cleanRule(item, i, actor);
      byRef.set(`${r.scope}:${r.ref}`, r);
    });
    const list = [...byRef.values()];
    if (!list.length) return { created: 0, updated: 0 };

    return this.retryOnConflict(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockResearch(tx, country.code);
        const now = new Date();
        const rows = await tx.productMarketRule.findMany({
          where: { countryCode: country.code, ref: { in: unique(list.map((r) => r.ref)) } },
          select: { scope: true, ref: true, availability: true, status: true },
        });
        const existing = new Map(rows.map((r) => [`${r.scope}:${r.ref}`, r]));
        let reopened = 0;
        for (const r of list) {
          const before = existing.get(`${r.scope}:${r.ref}`);
          const changed = !!before && before.status !== 'PENDING_REVIEW' && before.availability !== r.availability;
          if (changed) reopened++;
          const facts = {
            availability: r.availability, note: r.note, sources: json(r.sources), confidence: r.confidence,
            verifiedBy: r.verifiedBy, lastVerifiedAt: now,
          };
          await tx.productMarketRule.upsert({
            where: { countryCode_scope_ref: { countryCode: country.code, scope: r.scope, ref: r.ref } },
            update: { ...facts, ...(changed && { status: 'PENDING_REVIEW' as const }) },
            create: { countryCode: country.code, scope: r.scope, ref: r.ref, status: 'PENDING_REVIEW', ...facts },
          });
        }
        await tx.marketCountry.update({ where: { code: country.code }, data: { lastResearchedAt: now } });
        const created = list.filter((r) => !existing.has(`${r.scope}:${r.ref}`)).length;
        const result = { created, updated: list.length - created };
        await this.audit.record(tx, {
          actorId: actor.id, action: 'markets.rules.upsert', entityType: 'MarketCountry', entityId: country.code,
          after: { by: actor.label, refs: list.map((r) => `${r.scope}:${r.ref}`), reopened, ...result },
        });
        return result;
      }),
    );
  }

  /**
   * One research write per country at a time, so "created" and "updated" are counted right when
   * the same research arrives twice at once (the unique index already keeps one row per key).
   */
  private async lockResearch(tx: Prisma.TransactionClient, code: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`markets-research:${code}`}))`;
  }

  /** A write that still hits the unique index (a race the lock did not cover) runs once more as an update. */
  private async retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isP2002(e)) return fn();
      throw e;
    }
  }

  // ── the owner's decisions ──

  async decideMethod(id: string, action: MarketDecisionAction, note: string | undefined, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.marketPaymentMethod.findUnique({ where: { id } });
      if (!before) throw methodNotFound();
      // approving an ACTIVE method changes nothing; rejecting or deferring one unlinks its account
      const status: MarketReviewStatus =
        action === 'approve' ? (before.status === 'ACTIVE' ? 'ACTIVE' : 'APPROVED') : action === 'reject' ? 'REJECTED' : 'DEFERRED';
      const after = await tx.marketPaymentMethod.update({
        where: { id },
        data: {
          status, decisionById: actorId, decisionAt: new Date(), decisionNote: note || null,
          ...(status !== 'ACTIVE' && status !== 'APPROVED' && { accountId: null }),
        },
      });
      await this.audit.record(tx, {
        actorId, action: `markets.method.${action}`, entityType: 'MarketPaymentMethod', entityId: id,
        before: { status: before.status, accountId: before.accountId }, after: { status: after.status, accountId: after.accountId, note: note || null },
      });
      return after;
    });
  }

  async decideRule(id: string, action: MarketDecisionAction, note: string | undefined, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.productMarketRule.findUnique({ where: { id } });
      if (!before) throw ruleNotFound();
      const status: MarketReviewStatus = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'DEFERRED';
      const after = await tx.productMarketRule.update({
        where: { id },
        data: { status, decisionById: actorId, decisionAt: new Date() },
      });
      // rules have no note column: the note lives in the audit log
      await this.audit.record(tx, {
        actorId, action: `markets.rule.${action}`, entityType: 'ProductMarketRule', entityId: id,
        before: { status: before.status }, after: { status: after.status, note: note || null },
      });
      return after;
    });
  }

  /**
   * An approved method goes live by pointing at one of the owner's accounts: it must exist, be
   * usable (on and with a number) and already list this country. The account is only read, never
   * changed. An ACTIVE method may be pointed at another account the same way.
   */
  async linkAccount(id: string, accountId: string, actorId: string) {
    const method = await this.prisma.marketPaymentMethod.findUnique({ where: { id } });
    if (!method) throw methodNotFound();
    const linkable: MarketReviewStatus[] = ['APPROVED', 'ACTIVE'];
    const notApproved = () =>
      new ConflictException({ message: 'Approve this payment method before linking an account', error: 'METHOD_NOT_APPROVED', status: method.status });
    if (!linkable.includes(method.status)) throw notApproved();

    const account = (await this.manualAccounts()).find((a) => a.id === accountId);
    if (!account) throw new NotFoundException({ message: 'No payment account with this id', error: 'ACCOUNT_NOT_FOUND' });
    if (!isUsable(account)) {
      throw new BadRequestException({ message: 'This account is switched off or has no receiving number', error: 'ACCOUNT_NOT_USABLE' });
    }
    if (!account.countries.includes(method.countryCode)) {
      throw new BadRequestException({
        message: `This account is not offered in ${method.countryCode}: add the country to it in Payment methods first`,
        error: 'ACCOUNT_OTHER_COUNTRY',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      // the owner may have rejected it a moment ago
      const { count } = await tx.marketPaymentMethod.updateMany({
        where: { id, status: { in: linkable } },
        data: { status: 'ACTIVE', accountId: account.id },
      });
      if (!count) throw notApproved();
      await this.audit.record(tx, {
        actorId, action: 'markets.method.link_account', entityType: 'MarketPaymentMethod', entityId: id,
        before: { status: method.status, accountId: method.accountId }, after: { status: 'ACTIVE', accountId: account.id },
      });
      return tx.marketPaymentMethod.findUniqueOrThrow({ where: { id } });
    });
  }
}

function cleanMethod(item: MarketMethodInput, index: number, actor: MarketActor) {
  const key = cleanText(item?.key, 80).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(key)) throw invalidItem(index, 'key must be lowercase letters, digits, dots or dashes');
  const name = cleanText(item.name, 120);
  if (!name) throw invalidItem(index, 'name is required');
  const kind = cleanText(item.kind, 20).toLowerCase();
  if (!(METHOD_KINDS as readonly string[]).includes(kind)) throw invalidItem(index, `kind must be one of ${METHOD_KINDS.join(', ')}`);
  const currency = cleanText(item.currency, 3).toUpperCase();
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw invalidItem(index, 'currency must be a 3-letter code');
  return {
    key, name, kind,
    provider: optionalText(item.provider, 120),
    currency: currency || null,
    fees: optionalText(item.fees, 500),
    note: optionalText(item.note, 500),
    sources: cleanSources(item.sources, index),
    confidence: cleanConfidence(item.confidence),
    verifiedBy: cleanText(item.verifiedBy, 80) || actor.label,
  };
}

function cleanRule(item: MarketRuleInput, index: number, actor: MarketActor) {
  const scope = cleanText(item?.scope, 20) as MarketRuleInput['scope'];
  if (!RULE_SCOPES.includes(scope)) throw invalidItem(index, `scope must be one of ${RULE_SCOPES.join(', ')}`);
  const ref = cleanText(item.ref, 120);
  if (!ref) throw invalidItem(index, 'ref is required');
  if (!AVAILABILITIES.includes(item.availability)) throw invalidItem(index, `availability must be one of ${AVAILABILITIES.join(', ')}`);
  return {
    scope, ref,
    availability: item.availability,
    note: optionalText(item.note, 300),
    sources: cleanSources(item.sources, index),
    confidence: cleanConfidence(item.confidence),
    verifiedBy: cleanText(item.verifiedBy, 80) || actor.label,
  };
}
