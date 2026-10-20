import { randomBytes, randomUUID } from 'crypto';

import { REDACTED, scrubDeep, scrubText } from '../../src/modules/intelligence/scrubber';

/** Fake values are generated per run: nothing real lives in a test. */
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

describe('intelligence scrubber', () => {
  it('masks phone numbers with a + and 8–15 digits, keeping the last two', () => {
    const phone = `+222${digits(8)}`;
    const out = scrubText(`Le client ${phone} a payé`);
    expect(out).not.toContain(phone);
    expect(out).toContain(`+${'•'.repeat(phone.length - 3)}${phone.slice(-2)}`);
  });

  it('masks spaced international numbers and bare 8–15 digit runs', () => {
    const local = digits(8);
    expect(scrubText(`+222 ${local.slice(0, 2)} ${local.slice(2, 4)} ${local.slice(4)}`)).not.toMatch(/\d{3}/);
    expect(scrubText(`numéro ${local} reçu`)).toBe(`numéro ${'•'.repeat(6)}${local.slice(-2)} reçu`);
  });

  it('leaves short numbers, dates, uuids and file names alone', () => {
    const id = randomUUID();
    const text = `Commande 1500 MRU le 2026-10-20T10:00:00Z, id ${id}, migration 20261022000000_markets_intelligence`;
    expect(scrubText(text)).toBe(text);
  });

  it('masks emails to their first letter and domain', () => {
    const user = `x${randomUUID().slice(0, 8)}`;
    expect(scrubText(`écrire à ${user}@example.com svp`)).toBe(`écrire à x***@example.com svp`);
  });

  it('redacts long hex and mixed-case base64 tokens', () => {
    const hex = randomBytes(32).toString('hex');
    const b64 = `Ab1${randomBytes(30).toString('base64url')}`;
    expect(scrubText(`key ${hex}`)).toBe(`key ${REDACTED}`);
    expect(scrubText(`jwt ${b64} end`)).toBe(`jwt ${REDACTED} end`);
  });

  it('redacts key=, token=, password=, secret: and bearer values', () => {
    const v = randomUUID();
    expect(scrubText(`GET /x?api_key=${v}&page=2`)).toBe(`GET /x?api_key=${REDACTED}&page=2`);
    expect(scrubText(`token=${v}`)).toBe(`token=${REDACTED}`);
    expect(scrubText(`password: "${v}"`)).toBe(`password: ${REDACTED}`);
    expect(scrubText(`secret : ${v}`)).toBe(`secret : ${REDACTED}`);
    expect(scrubText(`Authorization: Bearer ${v}`)).not.toContain(v);
    expect(scrubText(`key=${v}`)).toBe(`key=${REDACTED}`);
  });

  it('keeps ordinary prose with "key:" and empty input', () => {
    expect(scrubText('key: orange-money-ml')).toBe('key: orange-money-ml');
    expect(scrubText('')).toBe('');
  });

  it('scrubs every string of a nested value, keys included, and keeps other types', () => {
    const phone = `+223${digits(8)}`;
    const when = new Date();
    const out = scrubDeep({ list: [{ ref: phone, n: 3, ok: true, at: when }], [phone]: null });
    expect(JSON.stringify(out)).not.toContain(phone);
    expect(out.list[0]).toMatchObject({ n: 3, ok: true, at: when });
  });
});
