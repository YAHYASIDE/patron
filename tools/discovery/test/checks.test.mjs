// The checks against the two fixture repositories: "known-issues" must be caught, "clean" must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { runDiscovery } from '../lib/run.mjs';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const env = { GITHUB_SHA: 'f'.repeat(40), GITHUB_REF_NAME: 'test-branch' };

const known = runDiscovery({ root: fixture('known-issues'), env });
const clean = runDiscovery({ root: fixture('clean'), env });
const byFp = (report, prefix) => report.discoveries.filter((d) => d.fingerprint.startsWith(prefix));

test('the run report has the ingest shape', () => {
  assert.equal(known.agent, 'discovery-cli');
  assert.equal(known.trigger, 'manual');
  assert.equal(known.status, 'SUCCEEDED');
  assert.equal(known.commit, 'f'.repeat(40));
  assert.equal(known.branch, 'test-branch');
  assert.deepEqual(Object.keys(known).sort(), ['agent', 'branch', 'commit', 'discoveries', 'status', 'summary', 'trigger']);
  for (const d of known.discoveries) {
    assert.deepEqual(
      Object.keys(d).filter((k) => k !== 'testResults').sort(),
      ['confidence', 'description', 'evidence', 'fingerprint', 'impact', 'kind', 'proposal', 'severity', 'title', 'verified'],
    );
    // the API's DiscoveryInputDto pattern (apps/api/src/modules/intelligence/dto/intelligence.dto.ts)
    assert.match(d.fingerprint, /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,199}$/, d.fingerprint);
    assert.ok(d.evidence.length > 0, d.fingerprint);
    for (const e of d.evidence) {
      assert.ok(['file', 'test', 'log', 'config'].includes(e.type), e.type);
      assert.match(e.ref, /:\d+$/, `${d.fingerprint} ref ${e.ref}`);
    }
    assert.ok(Number.isInteger(d.confidence) && d.confidence >= 0 && d.confidence <= 100);
    assert.equal(typeof d.verified, 'boolean');
  }
});

test('a focused test is caught (known issue)', () => {
  const only = byFp(known, 'focused-test:').find((d) => d.evidence[0].detail.startsWith('it.only'));
  assert.ok(only, 'it.only must be detected');
  assert.equal(only.severity, 'HIGH');
  assert.equal(only.verified, true);
  assert.match(only.evidence[0].ref, /^apps\/api\/test\/unit\/orders\.spec\.ts:3$/);
  // the fingerprint is path + call + test name, never a line number
  assert.ok(!only.fingerprint.includes(':3:') && only.fingerprint.includes('orders.spec.ts:it.only:'));
  const skipped = byFp(known, 'focused-test:').map((d) => d.evidence[0].detail.split('(')[0]).sort();
  assert.deepEqual(skipped, ['describe.skip', 'it.only', 'xit'], 'the commented it.only must not count');
});

test('an admin route without a permission decorator is caught (known issue)', () => {
  const routes = byFp(known, 'admin-route-no-permission:').map((d) => d.fingerprint).sort();
  assert.deepEqual(routes, [
    'admin-route-no-permission:DELETE_/admin/widgets/:id',
    'admin-route-no-permission:GET_/admin/widgets-export',
    'admin-route-no-permission:POST_/admin/widgets/import',
  ]);
  for (const d of byFp(known, 'admin-route-no-permission:')) {
    assert.equal(d.severity, 'HIGH');
    assert.equal(d.kind, 'security');
    assert.equal(d.verified, true);
  }
  const del = byFp(known, 'admin-route-no-permission:DELETE')[0];
  assert.match(del.evidence[0].ref, /widgets\.controller\.ts:\d+$/);
  assert.match(del.evidence[0].detail, /WidgetsAdminController\.remove/);
});

test('other known issues are reported', () => {
  assert.equal(byFp(known, 'module-without-unit-test:widgets').length, 1);
  assert.equal(byFp(known, 'todo-marker:apps/api/src/modules/widgets/widgets.service.ts').length, 1);
  assert.equal(byFp(known, 'todo-marker:').length, 1, 'one discovery per file');
  assert.equal(byFp(known, 'i18n-missing:apps/storefront/app/page.tsx').length, 1);
  assert.equal(byFp(known, 'i18n-placeholders:apps/storefront/app/page.tsx').length, 1);
  assert.deepEqual(byFp(known, 'payment-country:').map((d) => d.fingerprint).sort(), [
    'payment-country:account-all-countries:anywhere',
    'payment-country:mr-method-abroad:account:bankily',
    'payment-country:mr-method-abroad:market:masrvi-ne',
  ]);
  const region = byFp(known, 'region-locked-sku:').map((d) => d.fingerprint).sort();
  assert.deepEqual(region, ['region-locked-sku:UK', 'region-locked-sku:US']);
  const us = byFp(known, 'region-locked-sku:US')[0];
  assert.equal(us.verified, false);
  assert.equal(us.kind, 'opportunity');
  assert.match(us.evidence[0].detail, /GC-STEAM-US-10, GC-STEAM-US-20/);
});

test('the clean fixture yields none of those', () => {
  assert.deepEqual(clean.discoveries.map((d) => d.fingerprint), []);
  assert.equal(clean.status, 'SUCCEEDED');
});

test('a run is deterministic (same fingerprints, same order)', () => {
  const again = runDiscovery({ root: fixture('known-issues'), env });
  assert.deepEqual(again.discoveries, known.discoveries);
});

test('discoveries are sorted by severity', () => {
  const order = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
  const ranks = known.discoveries.map((d) => order.indexOf(d.severity));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});

test('a check that throws marks the run FAILED but keeps the others', () => {
  const boom = { name: 'boom', run: () => { throw new Error('kaput'); } };
  const ok = { name: 'ok', run: () => [] };
  const r = runDiscovery({ root: fixture('clean'), env, checks: [boom, ok] });
  assert.equal(r.status, 'FAILED');
  assert.match(r.summary, /boom: kaput/);
});

test('routes after a regex with brackets are still read (an unguarded one is caught)', () => {
  const r = runDiscovery({ root: fixture('regex-routes'), env });
  assert.deepEqual(byFp(r, 'admin-route-no-permission:').map((d) => d.fingerprint), ['admin-route-no-permission:GET_/admin/sanitize/leak']);
});
