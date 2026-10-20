'use client';

/**
 * Markets & intelligence (docs/contracts/intelligence-api.md): the discoveries
 * the scanners and agents found, the owner's decisions on them, and each
 * country's researched payment methods and product rules. Nothing here turns
 * anything on by itself: every write is a person's decision.
 */

import { useEffect, useState } from 'react';
import { api, ApiError, NOT_READY } from './api';

/* ─── Intelligence ─── */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type DiscoveryStatus = 'NEW' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'IN_PROGRESS' | 'DONE';
export type DiscoveryAction = 'approve' | 'reject' | 'defer' | 'reopen' | 'start' | 'done';
export type Tab = 'new' | 'critical' | 'opportunities' | 'pending' | 'done' | 'deferred' | 'all';

export type Evidence = { type: string; ref: string; detail?: string | null };

export type Discovery = {
  id: string;
  fingerprint: string;
  kind: string;
  title: string;
  description: string;
  evidence: Evidence[] | null;
  confidence: number;
  verified: boolean;
  severity: Severity;
  impact: string;
  proposal: string;
  status: DiscoveryStatus;
  source: string;
  testResults: unknown;
  branch: string | null;
  prUrl: string | null;
  seenCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  deferredUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DiscoveryDecision = {
  id: string;
  action: string;
  note: string | null;
  actorLabel: string;
  createdAt: string;
};

export type DiscoveryDetail = Discovery & { decisions?: DiscoveryDecision[] };

export type AgentRun = {
  id: string;
  agent: string;
  trigger: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | string;
  summary: string | null;
  discoveries: number;
  testsPassed: number | null;
  testsFailed: number | null;
  commit: string | null;
  branch: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type IntelSummary = {
  counts: { new: number; critical: number; opportunities: number; pending: number; done: number; deferred: number };
  tests: { last: AgentRun | null };
  agents: { agent: string; lastRun: AgentRun | null }[];
  scanners: { name: string; lastRunAt: string | null; stale: boolean }[];
};

/**
 * One line of the decision log. The contract only says "discoveries + market
 * methods/rules, newest first", so every descriptive field is optional and the
 * page shows whatever the server sends.
 */
export type DecisionLogEntry = {
  id?: string;
  action: string;
  note?: string | null;
  actorLabel?: string | null;
  createdAt?: string;
  decisionAt?: string;
  at?: string;
  /** discovery | method | rule */
  type?: string;
  subjectType?: string;
  title?: string | null;
  name?: string | null;
  ref?: string | null;
  discoveryId?: string | null;
  countryCode?: string | null;
  discovery?: { id: string; title: string } | null;
  subject?: { type?: string; id?: string; title?: string | null; countryCode?: string | null } | null;
};

export type ScanResult = { run: AgentRun; created: number; updated: number };

export const SUMMARY_PATH = '/admin/intelligence/summary';
export const discoveriesPath = (tab: Tab, q = '', cursor?: string | null, limit = 20) => {
  const s = new URLSearchParams({ tab, limit: String(limit) });
  if (q.trim()) s.set('q', q.trim());
  if (cursor) s.set('cursor', cursor);
  return `/admin/intelligence/discoveries?${s.toString()}`;
};
export const discoveryPath = (id: string) => `/admin/intelligence/discoveries/${encodeURIComponent(id)}`;
export const decisionsPath = (limit = 30) => `/admin/intelligence/decisions?limit=${limit}`;

export const getDiscoveries = (tab: Tab, q?: string, cursor?: string | null) =>
  api.get<{ data: Discovery[]; nextCursor: string | null }>(discoveriesPath(tab, q, cursor));

export const decideDiscovery = (id: string, action: DiscoveryAction, note?: string, deferDays?: number) =>
  api.post<Discovery>(`${discoveryPath(id)}/decision`, {
    action,
    ...(note && { note }),
    ...(action === 'defer' && deferDays && { deferDays }),
  });

export const scanNow = () => api.post<ScanResult>('/admin/intelligence/scan');

export const TABS: { key: Tab; label: string; count?: keyof IntelSummary['counts'] }[] = [
  { key: 'new', label: 'جديدة', count: 'new' },
  { key: 'critical', label: 'حرجة', count: 'critical' },
  { key: 'opportunities', label: 'فرص', count: 'opportunities' },
  { key: 'pending', label: 'بانتظار المراجعة', count: 'pending' },
  { key: 'done', label: 'مكتملة', count: 'done' },
  { key: 'deferred', label: 'مؤجلة', count: 'deferred' },
  { key: 'all', label: 'الكل' },
];

export const SEVERITY: Record<string, { label: string; cls: string }> = {
  CRITICAL: { label: 'حرجة', cls: 'bg-bad text-white' },
  HIGH: { label: 'عالية', cls: 'bg-bad/12 text-bad' },
  MEDIUM: { label: 'متوسطة', cls: 'bg-warn/12 text-warn' },
  LOW: { label: 'منخفضة', cls: 'bg-teal/12 text-teal' },
  INFO: { label: 'للعلم', cls: 'bg-ink-400/15 text-muted' },
};

export const DISCOVERY_STATUS: Record<string, { label: string; cls: string }> = {
  NEW: { label: 'جديد', cls: 'bg-teal/12 text-teal' },
  PENDING_REVIEW: { label: 'بانتظار المراجعة', cls: 'bg-warn/12 text-warn' },
  APPROVED: { label: 'موافق عليه', cls: 'bg-ok/12 text-ok' },
  REJECTED: { label: 'مرفوض', cls: 'bg-ink-400/15 text-muted' },
  DEFERRED: { label: 'مؤجل', cls: 'bg-ink-400/15 text-muted' },
  IN_PROGRESS: { label: 'قيد التنفيذ', cls: 'bg-teal/12 text-teal' },
  DONE: { label: 'تم', cls: 'bg-ok/12 text-ok' },
};

export const KIND: Record<string, string> = {
  bug: 'خلل',
  security: 'أمان',
  performance: 'سرعة',
  ux: 'تجربة الاستخدام',
  market: 'سوق',
  product: 'منتج',
  payment: 'دفع',
  data: 'بيانات',
  opportunity: 'فرصة',
  test: 'اختبار',
};

export const EVIDENCE_TYPE: Record<string, string> = {
  code: 'كود',
  test: 'اختبار',
  log: 'سجل',
  url: 'رابط',
  db: 'قاعدة البيانات',
  metric: 'قياس',
  ci: 'CI',
};

export const ACTION_LABEL: Record<string, string> = {
  approve: 'موافقة',
  reject: 'رفض',
  defer: 'تأجيل',
  reopen: 'إعادة فتح',
  start: 'بدء التنفيذ',
  done: 'تم',
};

export const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  RUNNING: { label: 'يعمل الآن', cls: 'bg-teal/12 text-teal' },
  SUCCEEDED: { label: 'نجح', cls: 'bg-ok/12 text-ok' },
  FAILED: { label: 'فشل', cls: 'bg-bad/12 text-bad' },
};

const AGENT_NAME: Record<string, string> = {
  'discovery-engine': 'محرك الاكتشاف',
  'market-scout': 'مستكشف الأسواق',
  'qa-tester': 'مختبر الجودة',
  'ci-analysis': 'تحليل CI',
  ci: 'تحليل CI',
  'catalog-readiness': 'جاهزية المنتجات',
  'payments-by-country': 'الدفع حسب الدولة',
  'market-staleness': 'تقادم بيانات الأسواق',
  'server-errors': 'أخطاء الخادم',
  'search-gaps': 'بحث بلا نتائج',
};
/** "scanner:catalog-readiness" → "جاهزية المنتجات" (or the raw name). */
export const agentName = (name: string) => AGENT_NAME[name.replace(/^scanner:/, '')] ?? name;

/** Which decisions make sense from a status. The server is the judge; this only hides nonsense buttons. */
export function actionsFor(status: DiscoveryStatus): DiscoveryAction[] {
  switch (status) {
    case 'NEW':
    case 'PENDING_REVIEW':
      return ['approve', 'reject', 'defer'];
    case 'APPROVED':
      return ['start', 'done', 'defer', 'reject'];
    case 'IN_PROGRESS':
      return ['done', 'defer', 'reopen'];
    case 'DEFERRED':
      return ['approve', 'reopen', 'reject'];
    case 'REJECTED':
    case 'DONE':
      return ['reopen'];
    default:
      return [];
  }
}

/* ─── Markets ─── */

export type MarketStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'DEFERRED' | 'ACTIVE';
export type Availability = 'AVAILABLE' | 'UNAVAILABLE' | 'REGION_ACCOUNT_REQUIRED' | 'UNKNOWN';
export type Source = { url?: string; title?: string; publisher?: string | null; accessedAt?: string };

export type MarketCountry = {
  code: string;
  nameAr: string;
  nameFr: string;
  nameEn: string;
  currency: string;
  currencies: string[];
  languages: string[];
  dialCode: string;
  enabled: boolean;
  notes?: string | null;
  lastResearchedAt: string | null;
};

export type MarketRow = MarketCountry & {
  methods: { pending: number; approved: number; active: number; rejected: number; deferred: number };
  rules: { pending: number; approved: number };
  stale: number;
};

export type MarketMethod = {
  id: string;
  countryCode: string;
  key: string;
  name: string;
  provider: string | null;
  kind: string;
  currency: string | null;
  fees: string | null;
  sources: Source[] | null;
  confidence: number;
  status: MarketStatus;
  lastVerifiedAt: string;
  verifiedBy: string;
  accountId: string | null;
  decisionAt: string | null;
  decisionNote: string | null;
};

export type MarketRule = {
  id: string;
  countryCode: string;
  scope: string;
  ref: string;
  availability: Availability;
  note: string | null;
  sources: Source[] | null;
  confidence: number;
  status: MarketStatus;
  lastVerifiedAt: string;
  verifiedBy: string;
  decisionAt: string | null;
};

export type MarketAccount = { id: string; method: string; enabled: boolean; usable: boolean };

export type MarketDetail = {
  country: MarketCountry;
  methods: MarketMethod[];
  rules: MarketRule[];
  accounts: MarketAccount[];
};

export type NewCountry = {
  code: string;
  nameAr: string;
  nameFr: string;
  nameEn: string;
  currency: string;
  currencies?: string[];
  languages?: string[];
  dialCode: string;
  notes?: string;
};

export type MarketAction = 'approve' | 'reject' | 'defer';

export const MARKETS_PATH = '/admin/markets';
export const marketPath = (code: string) => `/admin/markets/${encodeURIComponent(code)}`;

export const createMarket = (body: NewCountry) => api.post<MarketCountry>(MARKETS_PATH, body);
export const setMarketEnabled = (code: string, enabled: boolean) =>
  api.patch<MarketCountry>(marketPath(code), { enabled });
export const decideMethod = (id: string, action: MarketAction, note?: string) =>
  api.post<MarketMethod>(`/admin/markets/methods/${encodeURIComponent(id)}/decision`, { action, ...(note && { note }) });
export const linkMethodAccount = (id: string, accountId: string) =>
  api.post<MarketMethod>(`/admin/markets/methods/${encodeURIComponent(id)}/link-account`, { accountId });
export const decideRule = (id: string, action: MarketAction, note?: string) =>
  api.post<MarketRule>(`/admin/markets/rules/${encodeURIComponent(id)}/decision`, { action, ...(note && { note }) });

export const MARKET_STATUS: Record<string, { label: string; cls: string; hint?: string }> = {
  PENDING_REVIEW: { label: 'بانتظار المراجعة', cls: 'bg-warn/12 text-warn' },
  APPROVED: {
    label: 'موافق عليها',
    cls: 'bg-teal/12 text-teal',
    hint: 'لا تظهر للزبائن بعد: اربطها بحساب استقبال.',
  },
  ACTIVE: { label: 'ظاهرة للزبائن', cls: 'bg-ok/12 text-ok' },
  DEFERRED: { label: 'مؤجلة', cls: 'bg-ink-400/15 text-muted' },
  REJECTED: { label: 'مرفوضة', cls: 'bg-ink-400/15 text-muted' },
};

/** The order the country page groups methods in: what needs the owner first. */
export const MARKET_STATUS_ORDER: MarketStatus[] = ['PENDING_REVIEW', 'APPROVED', 'ACTIVE', 'DEFERRED', 'REJECTED'];

export const METHOD_KIND: Record<string, string> = {
  mobile_money: 'محفظة هاتف',
  bank: 'بنك',
  card: 'بطاقة',
  crypto: 'عملات رقمية',
  cash: 'نقدًا',
};

export const RULE_SCOPE: Record<string, string> = { product: 'منتج', brand: 'علامة / لعبة', category: 'تصنيف' };

export const AVAILABILITY: Record<string, { label: string; cls: string }> = {
  AVAILABLE: { label: 'متاح', cls: 'bg-ok/12 text-ok' },
  UNAVAILABLE: { label: 'غير متاح', cls: 'bg-bad/12 text-bad' },
  REGION_ACCOUNT_REQUIRED: { label: 'يحتاج حسابًا من منطقة معيّنة', cls: 'bg-warn/12 text-warn' },
  UNKNOWN: { label: 'غير معروف', cls: 'bg-ink-400/15 text-muted' },
};

/** Matches the server's default `markets.stale_days`. */
export const STALE_DAYS = 90;
export const isStale = (iso: string | null | undefined, days = STALE_DAYS) =>
  !iso || Date.now() - new Date(iso).getTime() > days * 86_400_000;

/* ─── Shared ─── */

const CODE_TEXT: [RegExp, string][] = [
  [/METHOD_NOT_APPROVED|not approved/i, 'وافق على الوسيلة أولًا، ثم اربطها بحساب.'],
  [/ACCOUNT_NOT_USABLE|not usable/i, 'هذا الحساب متوقف أو بلا رقم. فعّله وأضف رقمه في صفحة وسائل الدفع.'],
  [/ACCOUNT_OTHER_COUNTRY|other country|does not serve/i, 'هذا الحساب لا يخدم هذه الدولة. أضف الدولة إليه في صفحة وسائل الدفع.'],
  [/already exists|duplicate|unique/i, 'هذه الدولة موجودة من قبل.'],
];

/** An API failure in the owner's words. */
export function friendlyError(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية لهذا الإجراء.';
  for (const [re, text] of CODE_TEXT) if (re.test(e.message)) return text;
  return e.message;
}

/** A link we may open: only http(s), never javascript: or data:. */
export const safeUrl = (u: string | null | undefined): string | null => {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

const RTF_LOCALE = 'ar-EG-u-nu-latn';
/** "قبل 3 ساعات". */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return '—';
  const s = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(s);
  try {
    const rtf = new Intl.RelativeTimeFormat(RTF_LOCALE, { numeric: 'auto' });
    if (abs < 60) return rtf.format(s, 'second');
    if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (abs < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
    if (abs < 30 * 86_400) return rtf.format(Math.round(s / 86_400), 'day');
    return rtf.format(Math.round(s / (30 * 86_400)), 'month');
  } catch {
    return new Date(iso).toLocaleDateString(RTF_LOCALE);
  }
}

type Me = { roles?: string[]; permissions?: string[] };

/**
 * What the signed-in staff member may do here. /auth/me lists role names; the
 * built-in roles with these permissions are super_admin and admin
 * (migration 20261022000000). If the server ever adds `permissions` to
 * /auth/me, that list wins. Hiding a button is a courtesy: the API enforces.
 */
export function useStaffCan(): { ready: boolean; can: (permission: string) => boolean } {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .get<Me>('/auth/me')
      .then((m) => alive && setMe(m))
      .catch(() => alive && setMe(null))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);
  const can = (permission: string) => {
    if (!me) return false;
    const roles = me.roles ?? [];
    if (roles.includes('super_admin')) return true;
    if (Array.isArray(me.permissions)) return me.permissions.includes(permission);
    return roles.includes('admin');
  };
  return { ready, can };
}
