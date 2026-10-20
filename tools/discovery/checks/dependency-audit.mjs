// `npm audit --json` results (--audit [label=]<file>, repeatable). One discovery per app and
// vulnerable package that carries its own advisory; packages that are only vulnerable through
// another one are listed in that package's evidence.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { read } from '../lib/fs.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'dependency-audit';

const SEVERITY = { critical: 'CRITICAL', high: 'HIGH', moderate: 'MEDIUM', low: 'LOW', info: 'INFO' };

/** `api=audit.json` → { label: 'api', file }; `audit-api.json` → label 'api'. */
export function parseAuditArg(arg) {
  const eq = arg.indexOf('=');
  if (eq > 0 && !arg.slice(0, eq).includes('/')) return { label: arg.slice(0, eq), file: arg.slice(eq + 1) };
  const label = basename(arg)
    .replace(/\.json$/i, '')
    .replace(/(?:^|[-_.])(?:npm|audit)(?=[-_.]|$)/gi, '')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return { label: label || basename(arg), file: arg };
}

export function run({ root, audits = [], notes = [] }) {
  const out = [];
  for (const arg of audits) {
    const { label, file } = parseAuditArg(arg);
    let report;
    try {
      report = JSON.parse(read(file));
    } catch {
      notes.push(`تعذّرت قراءة تقرير npm audit (${label}).`);
      continue;
    }
    if (report.error || !report.vulnerabilities) {
      notes.push(`تقرير npm audit (${label}) لا يحتوي نتائج${report.error?.summary ? `: ${String(report.error.summary).slice(0, 120)}` : ''}.`);
      continue;
    }
    const manifest = ['apps', 'packages'].map((d) => join(d, label, 'package.json')).find((p) => existsSync(join(root, p)));
    const ref = `${manifest ?? basename(file)}:1`;
    const vulns = report.vulnerabilities;
    for (const [pkg, v] of Object.entries(vulns)) {
      const advisories = (v.via ?? []).filter((x) => x && typeof x === 'object');
      if (!advisories.length) continue;
      const dependents = Object.entries(vulns)
        .filter(([other, o]) => other !== pkg && (o.via ?? []).includes(pkg))
        .map(([other]) => other);
      const fix =
        v.fixAvailable === true
          ? 'npm audit fix'
          : v.fixAvailable && typeof v.fixAvailable === 'object'
            ? `${v.fixAvailable.name}@${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (major)' : ''}`
            : null;
      out.push(
        discovery(name, `${label}:${pkg}`, {
          kind: 'security',
          title: `ثغرة ${v.severity} في الاعتمادية ${pkg} (${label})`,
          description:
            `npm audit (اعتماديات الإنتاج) يبلّغ عن ${advisories.length} تنبيه أمني في ${pkg}@${v.range ?? '?'} ضمن ${label}` +
            `${v.isDirect ? ' (اعتمادية مباشرة)' : ' (اعتمادية غير مباشرة)'}${dependents.length ? `، وتتأثر بها: ${dependents.slice(0, 5).join('، ')}` : ''}.`,
          evidence: advisories.slice(0, 5).map((a) => ({
            type: 'config',
            ref,
            detail: `${a.severity ?? v.severity}: ${a.title ?? a.name ?? pkg}${a.url ? ` — ${a.url}` : ''}`,
          })),
          confidence: 85,
          verified: true,
          severity: SEVERITY[v.severity] ?? 'MEDIUM',
          impact: 'ثغرة معروفة في مكتبة تعمل في الإنتاج؛ أثرها الفعلي يعتمد على طريقة استخدامها.',
          proposal: fix ? `حدّث (${fix}) في ${label} وشغّل الاختبارات كاملة.` : `لا يوجد إصلاح متاح بعد؛ قيّم استخدام ${pkg} في ${label} أو استبدله.`,
          testResults: { fixAvailable: Boolean(v.fixAvailable), isDirect: Boolean(v.isDirect) },
        }),
      );
    }
  }
  return out;
}
