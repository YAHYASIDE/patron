// Nothing sensitive leaves the CLI. Every "secret" here is generated at run time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { scrub, scrubText } from '../lib/scrub.mjs';

const digits = (n) => Array.from({ length: n }, () => randomInt(10)).join('');
const token = () => randomBytes(24).toString('hex'); // 48 hex chars, letters and digits

test('phone and account numbers are masked, keeping only the last two digits', () => {
  const phone = `+222${digits(8)}`;
  const out = scrubText(`customer ${phone} paid`);
  assert.ok(!out.includes(phone.slice(1)), out);
  assert.ok(out.endsWith(`${phone.slice(-2)} paid`), out);
  const spaced = `${digits(2)} ${digits(2)} ${digits(2)} ${digits(2)}`;
  assert.ok(!scrubText(`call ${spaced}`).includes(spaced));
});

test('dates, versions, short numbers and line refs survive', () => {
  for (const s of ['2026-10-20', 'v1.2.3', 'HTTP 404', 'file.ts:1234', 'GC-APPLE-US-100', '25 SKUs']) {
    assert.equal(scrubText(s), s);
  }
});

test('e-mails keep the first letter and the domain', () => {
  const user = `u${randomUUID().slice(0, 8)}`;
  assert.equal(scrubText(`from ${user}@example.test`), `from u***@example.test`);
});

test('tokens, JWTs, bearer headers and secret assignments are redacted', () => {
  const t = token();
  const jwt = `eyJ${randomBytes(12).toString('base64url')}.${randomBytes(12).toString('base64url')}.${randomBytes(12).toString('base64url')}`;
  const pwd = randomUUID();
  const text = scrubText(`key=${t} Authorization: Bearer ${t} jwt ${jwt} password="${pwd}" token: ${t.slice(0, 10)} id ${t}`);
  for (const secret of [t, jwt, pwd, t.slice(0, 10)]) assert.ok(!text.includes(secret), `${secret} leaked: ${text}`);
  assert.match(text, /password=\[redacted\]/);
});

test('scrub() walks objects and arrays and leaves non-strings alone', () => {
  const phone = digits(10);
  const out = scrub({ a: [`n ${phone}`, 3, true, null], b: { c: `x ${phone}` } });
  assert.equal(out.a[1], 3);
  assert.equal(out.a[2], true);
  assert.equal(out.a[3], null);
  assert.ok(!JSON.stringify(out).includes(phone));
});
