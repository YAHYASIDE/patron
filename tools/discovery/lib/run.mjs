// Runs every check against a repository root and builds the run report.
import { execFileSync } from 'node:child_process';
import * as focusedTests from '../checks/focused-tests.mjs';
import * as adminPermissions from '../checks/admin-permissions.mjs';
import * as moduleTests from '../checks/module-tests.mjs';
import * as i18nMissing from '../checks/i18n-missing.mjs';
import * as todoMarkers from '../checks/todo-markers.mjs';
import * as paymentCountries from '../checks/payment-countries.mjs';
import * as regionSkus from '../checks/region-skus.mjs';
import * as errorLogs from '../checks/error-logs.mjs';
import * as dependencyAudit from '../checks/dependency-audit.mjs';
import { countBySeverity, dedupe, sortDiscoveries } from './discovery.mjs';
import { scrub, scrubText } from './scrub.mjs';

export const CHECKS = [
  focusedTests, adminPermissions, moduleTests, i18nMissing, todoMarkers, paymentCountries, regionSkus, errorLogs, dependencyAudit,
];

export const AGENT = 'discovery-cli';

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function defaultTrigger(env) {
  if (env.GITHUB_EVENT_NAME === 'schedule') return 'schedule';
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') return 'manual';
  return env.GITHUB_ACTIONS === 'true' ? 'ci' : 'manual';
}

/**
 * The run report `{ agent, trigger, status, summary, commit, branch, discoveries }`, shaped for
 * POST /admin/intelligence/ingest. Read-only on `root`.
 */
export function runDiscovery({ root, logs, audits = [], trigger, env = process.env, checks = CHECKS }) {
  const notes = [];
  const failed = [];
  const found = [];
  for (const check of checks) {
    try {
      found.push(...check.run({ root, logs, audits, notes }));
    } catch (err) {
      failed.push(`${check.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const discoveries = sortDiscoveries(dedupe(found.map(scrub)));
  const counts = countBySeverity(discoveries);
  const countText = Object.entries(counts)
    .filter(([, n]) => n)
    .map(([s, n]) => `${s} ${n}`)
    .join('، ');
  const summary = [
    `${checks.length} فحصًا، ${discoveries.length} اكتشافًا${countText ? ` (${countText})` : ''}.`,
    ...notes,
    ...(failed.length ? [`فحوصات فشلت: ${failed.join('؛ ')}`] : []),
  ].join(' ');
  const commit = env.GITHUB_SHA || git(root, ['rev-parse', 'HEAD']);
  const branch = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    agent: AGENT,
    trigger: trigger ?? defaultTrigger(env),
    status: failed.length ? 'FAILED' : 'SUCCEEDED',
    summary: scrubText(summary),
    ...(commit && { commit }),
    ...(branch && { branch }),
    discoveries,
  };
}
