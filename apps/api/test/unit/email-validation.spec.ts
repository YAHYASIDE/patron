import { isEmail } from '../../src/common/validation/email';

describe('isEmail', () => {
  it('accepts ordinary addresses and refuses broken ones', () => {
    for (const ok of ['a@b.co', 'owner.shop@mail.example.mr', 'x+tag@sub.domain.io']) expect(isEmail(ok)).toBe(true);
    for (const bad of ['', 'a@b', '@b.co', 'a@.co', 'a@b.', 'a@@b.co', 'a b@c.co', 'a@b c.co']) expect(isEmail(bad)).toBe(false);
  });

  it('checks the top-level domain only when asked', () => {
    expect(isEmail('a@b.c1')).toBe(true);
    expect(isEmail('a@b.c1', { tld: true })).toBe(false);
    expect(isEmail('a@b.com', { tld: true })).toBe(true);
  });

  it('stays fast on the input that made the old pattern backtrack', () => {
    const evil = '!@!.' + '!.'.repeat(50_000);
    const start = Date.now();
    expect(isEmail(evil, { max: 200_000 })).toBe(false); // ends with a dot
    expect(isEmail(`${evil}x`, { max: 200_000 })).toBe(true);
    expect(Date.now() - start).toBeLessThan(200);
    expect(isEmail('a@b.co'.padEnd(300, 'x'))).toBe(false);
  });
});
