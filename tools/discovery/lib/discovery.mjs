// DiscoveryInput helpers (docs/contracts/intelligence-api.md).
import { createHash } from 'node:crypto';

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

/** A short, stable hash for fingerprint keys that would otherwise be long or contain text. */
export const shortHash = (text) => createHash('sha1').update(String(text)).digest('hex').slice(0, 12);

/**
 * The API accepts fingerprints of `[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,199}` only: spaces (in a route
 * key like "GET /admin/x") become "_", any other character "-", and an over-long key is hashed.
 */
export function fingerprintOf(check, key) {
  const raw = `${check}:${key}`.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._:/@#-]/g, '-');
  return raw.length <= 200 ? raw : `${check}:${shortHash(key)}`;
}

/**
 * Builds a DiscoveryInput. `check` + `key` make the fingerprint, so the same subject found again is the
 * same discovery (never a line number alone: keys are paths, routes, ids or hashes of content).
 */
export function discovery(check, key, fields) {
  const {
    kind, title, description, evidence = [], confidence, verified, severity, impact, proposal, testResults,
  } = fields;
  if (!SEVERITIES.includes(severity)) throw new Error(`${check}: bad severity ${severity}`);
  return {
    fingerprint: fingerprintOf(check, key),
    kind,
    title,
    description,
    evidence: evidence.map((e) => ({ type: e.type, ref: e.ref, ...(e.detail !== undefined && { detail: e.detail }) })),
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    verified: Boolean(verified),
    severity,
    impact,
    proposal,
    ...(testResults !== undefined && { testResults }),
  };
}

/** One discovery per fingerprint: the first wins, later evidence is appended (deduplicated). */
export function dedupe(list) {
  const byFp = new Map();
  for (const d of list) {
    const seen = byFp.get(d.fingerprint);
    if (!seen) {
      byFp.set(d.fingerprint, { ...d, evidence: [...d.evidence] });
      continue;
    }
    for (const e of d.evidence) {
      if (!seen.evidence.some((x) => x.type === e.type && x.ref === e.ref)) seen.evidence.push(e);
    }
  }
  return [...byFp.values()];
}

/** Most severe first, then by fingerprint, so the output is stable between runs. */
export function sortDiscoveries(list) {
  return [...list].sort(
    (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.fingerprint.localeCompare(b.fingerprint),
  );
}

export function countBySeverity(list) {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const d of list) counts[d.severity]++;
  return counts;
}
