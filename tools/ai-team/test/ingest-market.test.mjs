import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toIngest } from '../ingest-market.mjs';

const repo = resolve(import.meta.dirname, '../../..');
const MR_ONLY = /bankily|masrvi|sedad|click/i;

for (const code of ['ML', 'SN', 'MR']) {
  test(`docs/markets/${code}.json is a valid ingest, every method sourced, unconfirmed facts at low confidence`, () => {
    const research = JSON.parse(readFileSync(resolve(repo, `docs/markets/${code}.json`), 'utf8'));
    const body = toIngest(code, research);
    assert.equal(body.market.code, code);
    assert.ok(body.market.methods.length > 0);
    for (const m of body.market.methods) {
      assert.ok(m.sources.length > 0 && m.sources.every((s) => /^https:\/\//.test(s.url) && s.accessedAt), m.key);
      assert.ok(m.confidence <= 40, `${m.key}: no page was fetched, confidence must stay ≤ 40`);
      if (code !== 'MR') assert.doesNotMatch(`${m.key} ${m.name}`, MR_ONLY, `${code} must not list a Mauritanian method`);
    }
    // source URLs carry long article ids; everything else must hold no phone or account number
    const text = JSON.stringify(body, (k, v) => (k === 'url' ? undefined : v));
    assert.doesNotMatch(text, /\b\d{8,}\b/, 'no phone or account numbers');
  });
}

test('a method without a source is refused', () => {
  assert.throws(() => toIngest('x', { code: 'ML', methods: [{ key: 'a', name: 'A', kind: 'bank', sources: [] }] }), /no source/);
});
