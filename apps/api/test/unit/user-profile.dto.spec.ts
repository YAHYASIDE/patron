import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from '../../src/modules/users/dto/user.dto';

async function errors(body: Record<string, unknown>) {
  const dto = plainToInstance(UpdateUserDto, body);
  const result = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, fields: result.map((e) => e.property) };
}

describe('UpdateUserDto (profile)', () => {
  it('accepts a country, a city, the language and the currency', async () => {
    const { dto, fields } = await errors({ country: 'MR', city: '  Nouakchott   Tevragh  ', locale: 'fr', defaultCurrency: 'MRU' });
    expect(fields).toEqual([]);
    expect(dto.city).toBe('Nouakchott Tevragh');
  });

  it('accepts Arabic and accented city names and the other store currencies', async () => {
    expect((await errors({ city: 'نواكشوط' })).fields).toEqual([]);
    expect((await errors({ city: "Aïn Témouchent" })).fields).toEqual([]);
    expect((await errors({ city: "N'Djamena" })).fields).toEqual([]);
    expect((await errors({ defaultCurrency: 'DZD' })).fields).toEqual([]);
    expect((await errors({ defaultCurrency: 'XOF', locale: 'ar' })).fields).toEqual([]);
  });

  it('refuses a lowercase or unknown country', async () => {
    expect((await errors({ country: 'mr' })).fields).toEqual(['country']);
    expect((await errors({ country: 'ZZ' })).fields).toEqual(['country']);
    expect((await errors({ country: 'MRT' })).fields).toEqual(['country']);
  });

  it('refuses a city with digits, symbols, nothing or over 60 characters', async () => {
    expect((await errors({ city: 'Nouakchott 5' })).fields).toEqual(['city']);
    expect((await errors({ city: '<script>' })).fields).toEqual(['city']);
    expect((await errors({ city: '   ' })).fields).toEqual(['city']);
    expect((await errors({ city: 'a'.repeat(61) })).fields).toEqual(['city']);
  });

  it('refuses an unsupported language or currency', async () => {
    expect((await errors({ locale: 'de' })).fields).toEqual(['locale']);
    expect((await errors({ defaultCurrency: 'GBP' })).fields).toEqual(['defaultCurrency']);
  });
});
