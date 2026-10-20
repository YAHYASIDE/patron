import { DiscoverySeverity, DiscoveryStatus } from '@prisma/client';

/** bug | security | … (schema comment) plus `catalog`, which the market skill uses for unready products. */
export const DISCOVERY_KINDS = [
  'bug', 'security', 'performance', 'ux', 'market', 'product', 'payment', 'data', 'opportunity', 'test', 'catalog',
] as const;
export type DiscoveryKind = (typeof DISCOVERY_KINDS)[number];

export const EVIDENCE_TYPES = ['code', 'test', 'log', 'url', 'db', 'metric', 'ci'] as const;
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const satisfies readonly DiscoverySeverity[];

export const TABS = ['new', 'critical', 'opportunities', 'pending', 'done', 'deferred', 'all'] as const;
export type Tab = (typeof TABS)[number];

export const DECISION_ACTIONS = ['approve', 'reject', 'defer', 'reopen', 'start', 'done'] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

/** Where each action leads. */
export const ACTION_STATUS: Record<DecisionAction, DiscoveryStatus> = {
  approve: 'APPROVED',
  reject: 'REJECTED',
  defer: 'DEFERRED',
  reopen: 'PENDING_REVIEW',
  start: 'IN_PROGRESS',
  done: 'DONE',
};

/**
 * Which statuses each action may start from. A closed discovery (DONE,
 * REJECTED) only reopens; nothing jumps straight from closed to working.
 */
export const ACTION_FROM: Record<DecisionAction, readonly DiscoveryStatus[]> = {
  approve: ['NEW', 'PENDING_REVIEW', 'DEFERRED'],
  reject: ['NEW', 'PENDING_REVIEW', 'DEFERRED', 'APPROVED', 'IN_PROGRESS'],
  defer: ['NEW', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS'],
  reopen: ['DONE', 'REJECTED', 'DEFERRED'],
  start: ['NEW', 'PENDING_REVIEW', 'APPROVED', 'DEFERRED'],
  done: ['NEW', 'PENDING_REVIEW', 'APPROVED', 'IN_PROGRESS', 'DEFERRED'],
};

export const CLOSED: readonly DiscoveryStatus[] = ['DONE', 'REJECTED'];

export const DEFAULT_DEFER_DAYS = 7;

/** AgentRun.status values (schema comment). */
export const RUN_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_TRIGGERS = ['manual', 'schedule', 'ci', 'app'] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export interface EvidenceInput {
  type: (typeof EVIDENCE_TYPES)[number];
  ref: string;
  detail?: string;
}

/** What an agent, CI or a scanner reports (contract `DiscoveryInput`). */
export interface DiscoveryInput {
  fingerprint: string;
  kind: DiscoveryKind;
  title: string;
  description: string;
  evidence: EvidenceInput[];
  confidence: number;
  verified: boolean;
  severity: DiscoverySeverity;
  impact: string;
  proposal: string;
  testResults?: Record<string, unknown>;
  branch?: string;
  prUrl?: string;
}

/** The in-app scanners, by the name their AgentRun carries (`scanner:<name>`). */
export const SCANNER_NAMES = [
  'catalog-readiness', 'payments-by-country', 'market-staleness', 'server-errors', 'search-gaps',
] as const;
export type ScannerName = (typeof SCANNER_NAMES)[number];

export interface Scanner {
  readonly name: ScannerName;
  /** What is wrong right now. Read-only: a scanner never changes what it looks at. */
  scan(now: Date): Promise<DiscoveryInput[]>;
}

/** The summary warns when a scanner has not run for this long (the job is daily). */
export const SCANNER_STALE_MS = 2 * 86_400_000;
export const SCANNERS_AGENT = 'scanners';
export const scannerAgent = (name: string) => `scanner:${name}`;
