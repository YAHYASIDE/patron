// --logs grouping and --audit summaries, with inputs generated at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { errorMessage, normalize, run as runLogs } from '../checks/error-logs.mjs';
import { parseAuditArg, run as runAudit } from '../checks/dependency-audit.mjs';
import { scrub } from '../lib/scrub.mjs';

const root = fileURLToPath(new URL('./fixtures/clean', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'discovery-test-'));
const phone = () => `+222${String(randomInt(10_000_000, 99_999_999))}`;

test('error lines are recognised in text and pino JSON, info lines are not', () => {
  assert.equal(errorMessage('[2026-10-20T10:00:00Z] INFO started'), null);
  assert.ok(errorMessage('2026-10-20 ERROR payment failed'));
  assert.ok(errorMessage('TypeError: x is undefined'));
  assert.equal(errorMessage(JSON.stringify({ level: 30, msg: 'ok' })), null);
  assert.equal(errorMessage(JSON.stringify({ level: 50, msg: 'boom', err: { type: 'Error', message: 'db down' } })), 'boom — Error — db down');
});

test('normalize blanks ids, numbers, quoted values and e-mails', () => {
  const a = normalize(`2026-10-20T10:00:00.123Z ERROR order ${randomUUID()} failed for "${randomUUID()}" amount 12.5 user a@b.test`);
  const b = normalize(`2026-10-21T11:11:11.999Z ERROR order ${randomUUID()} failed for "x" amount 99 user c@d.test`);
  assert.equal(a, b);
  assert.equal(a, 'ERROR order {id} failed for {v} amount {n} user {email}');
});

test('repeated errors are grouped, counted, ranked and scrubbed', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(`2026-10-20T10:00:${String(i).padStart(2, '0')}Z ERROR otp send failed for ${phone()} order ${randomUUID()}`);
  for (let i = 0; i < 3; i++) lines.push(JSON.stringify({ level: 50, msg: `upstream timeout after ${randomInt(1000, 9000)}ms` }));
  lines.push('2026-10-20T10:00:00Z ERROR happened once');
  lines.push('2026-10-20T10:00:00Z INFO all good');
  const file = join(dir, 'api.log');
  writeFileSync(file, lines.join('\n'));
  const found = scrub(runLogs({ root, logs: file }));
  assert.equal(found.length, 2, 'single occurrences are left out');
  assert.equal(found[0].testResults.occurrences, 12);
  assert.equal(found[0].severity, 'MEDIUM');
  assert.equal(found[1].testResults.occurrences, 3);
  assert.equal(found[1].severity, 'LOW');
  assert.equal(found[0].verified, false);
  assert.match(found[0].evidence[0].ref, /^api\.log:1$/, 'a log outside the repo is shown by file name only');
  assert.ok(!/\+222\d{8}/.test(JSON.stringify(found)), 'phone numbers never reach the output');
  // same message, new ids → same fingerprint on the next run
  const again = runLogs({ root, logs: file });
  assert.equal(again[0].fingerprint, found[0].fingerprint);
});

test('audit labels come from "label=file" or the file name', () => {
  assert.deepEqual(parseAuditArg('api=out/a.json'), { label: 'api', file: 'out/a.json' });
  assert.equal(parseAuditArg('/tmp/x/audit-storefront.json').label, 'storefront');
  assert.equal(parseAuditArg('admin.npm-audit.json').label, 'admin');
});

test('npm audit results become one discovery per advised package', () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      'left-pad-x': {
        name: 'left-pad-x', severity: 'high', isDirect: false, range: '<1.2.0', fixAvailable: true,
        via: [{ source: 1, name: 'left-pad-x', title: 'Prototype pollution', url: 'https://github.com/advisories/GHSA-test-0000-0000', severity: 'high' }],
      },
      'wrapper-x': { name: 'wrapper-x', severity: 'high', isDirect: true, range: '*', fixAvailable: true, via: ['left-pad-x'] },
    },
    metadata: { vulnerabilities: { high: 2, total: 2 } },
  };
  const file = join(dir, 'audit-api.json');
  writeFileSync(file, JSON.stringify(report));
  const bad = join(dir, 'audit-admin.json');
  writeFileSync(bad, JSON.stringify({ error: { code: 'ENOLOCK', summary: 'no lockfile' } }));
  const notes = [];
  const found = runAudit({ root, audits: [file, `admin=${bad}`], notes });
  assert.equal(found.length, 1);
  assert.equal(found[0].fingerprint, 'dependency-audit:api:left-pad-x');
  assert.equal(found[0].severity, 'HIGH');
  assert.equal(found[0].kind, 'security');
  assert.match(found[0].description, /wrapper-x/);
  assert.match(found[0].evidence[0].detail, /Prototype pollution/);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /admin/);
});
