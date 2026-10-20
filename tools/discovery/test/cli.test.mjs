// The CLI end to end: arguments, output files, the Arabic report, and --ingest against a local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ingest, parseArgs } from '../index.mjs';
import { toMarkdown } from '../lib/report.mjs';
import { runDiscovery } from '../lib/run.mjs';

const cli = fileURLToPath(new URL('../index.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'discovery-cli-'));
const baseEnv = { PATH: process.env.PATH, GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'b' };

test('arguments parse, including --flag=value and repeated --audit', () => {
  const o = parseArgs(['--root', 'x', '--out=r.json', '--audit', 'a.json', '--audit', 'api=b.json', '--ingest']);
  assert.equal(o.root, 'x');
  assert.equal(o.out, 'r.json');
  assert.deepEqual(o.audits, ['a.json', 'api=b.json']);
  assert.equal(o.ingest, true);
  assert.throws(() => parseArgs(['--nope']), /unknown option/);
  assert.throws(() => parseArgs(['--out']), /needs a value/);
});

test('the CLI writes the JSON and the Arabic Markdown report and exits 0', () => {
  const out = join(dir, 'report.json');
  const md = join(dir, 'report.md');
  const r = spawnSync(process.execPath, [cli, '--root', fixture('known-issues'), '--out', out, '--md', md, '--trigger', 'ci'], {
    env: baseEnv,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(report.trigger, 'ci');
  assert.ok(report.discoveries.some((d) => d.fingerprint === 'admin-route-no-permission:DELETE /admin/widgets/:id'));
  const text = readFileSync(md, 'utf8');
  assert.match(text, /العدد حسب الخطورة/);
  assert.match(text, /\| عالٍ \(HIGH\) \| \d+ \|/);
  assert.match(text, /«مؤكد»/);
  assert.match(text, /«تقدير»/);
});

test('without --out the JSON goes to stdout; a bad option exits 64', () => {
  const r = spawnSync(process.execPath, [cli, '--root', fixture('clean')], { env: baseEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).discoveries.length, 0);
  assert.equal(spawnSync(process.execPath, [cli, '--bogus'], { env: baseEnv }).status, 64);
});

test('the Markdown report escapes HTML and says when there is nothing', () => {
  const md = toMarkdown({ agent: 'discovery-cli', trigger: 'manual', status: 'SUCCEEDED', summary: '<b>x</b>', discoveries: [] });
  assert.match(md, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(md, /لا توجد اكتشافات/);
});

test('--ingest is skipped with a message when the env is not set', async () => {
  const logs = [];
  const ok = await ingest({ discoveries: [] }, {}, (m) => logs.push(m));
  assert.equal(ok, true);
  assert.match(logs[0], /ingest skipped/);
});

test('--ingest posts the report with x-intel-token and never prints the token', async (t) => {
  const token = randomUUID();
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, token: req.headers['x-intel-token'], body: JSON.parse(body) });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ run: { id: 'r1' }, created: 3, updated: 1 }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/v1/`;
  const report = runDiscovery({ root: fixture('known-issues'), env: baseEnv });
  const logs = [];
  const ok = await ingest(report, { INTEL_API_URL: base, INTEL_INGEST_TOKEN: token }, (m) => logs.push(m));
  assert.equal(ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/v1/admin/intelligence/ingest');
  assert.equal(seen[0].token, token);
  assert.equal(seen[0].body.agent, 'discovery-cli');
  assert.equal(seen[0].body.discoveries.length, report.discoveries.length);
  assert.match(logs.join('\n'), /ingest ok: HTTP 201, created 3, updated 1/);
  assert.ok(!logs.join('\n').includes(token));
});

test('--ingest reports an HTTP error without echoing the token', async (t) => {
  const token = randomUUID();
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'BAD_TOKEN', got: token }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const logs = [];
  const ok = await ingest({ discoveries: [] }, { INTEL_API_URL: `http://127.0.0.1:${server.address().port}`, INTEL_INGEST_TOKEN: token }, (m) => logs.push(m));
  assert.equal(ok, false);
  assert.match(logs[0], /ingest failed: HTTP 401/);
  assert.ok(!logs.join('\n').includes(token));
});
