import { countryFromPhone, DIAL_CODES } from '../../src/common/reference/phone-country';

describe('countryFromPhone', () => {
  it.each([
    ['+22222123456', 'MR'],
    ['+22370123456', 'ML'],
    ['+213550123456', 'DZ'],
    ['+22790123456', 'NE'],
    ['+201001234567', 'EG'],
    ['+33612345678', 'FR'],
    ['+966501234567', 'SA'],
  ])('%s → %s', (phone, country) => {
    expect(countryFromPhone(phone)).toBe(country);
  });

  it('leaves shared, unknown and missing numbers empty', () => {
    expect(countryFromPhone('+14155550100')).toBeNull();
    expect(countryFromPhone('+79161234567')).toBeNull();
    expect(countryFromPhone('+999123')).toBeNull();
    expect(countryFromPhone('22222123456')).toBeNull();
    expect(countryFromPhone(null)).toBeNull();
    expect(countryFromPhone(undefined)).toBeNull();
  });

  it('has prefix-free codes, so no number matches two countries', () => {
    const codes = Object.keys(DIAL_CODES);
    for (const a of codes) for (const b of codes) if (a !== b) expect(b.startsWith(a)).toBe(false);
  });
});
