import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProductDto } from '../../src/modules/catalog/dto/catalog.dto';

/** The global ValidationPipe runs with whitelist + forbidNonWhitelisted. */
const errors = async (plain: object) =>
  (await validate(plainToInstance(UpdateProductDto, plain), { whitelist: true, forbidNonWhitelisted: true }))
    .map((e) => e.property);

const product = (over: object = {}) => ({
  sku: 'TOP-MATTEL-100', type: 'GAME_TOPUP', delivery: 'MANUAL', nameAr: 'شحن', nameEn: 'Top-up',
  categoryId: '3f1c2b4e-8a6d-4f7b-9c2e-1a2b3c4d5e6f', costPrice: 2.44, sellPrice: 2.51, ...over,
});

describe('product DTO: fixed prices per currency', () => {
  it('accepts a list of fixed prices, an empty list (all automatic) or none', async () => {
    expect(await errors(product({ prices: [{ currencyCode: 'MRU', sellPrice: 100 }] }))).toEqual([]);
    expect(await errors(product({ prices: [] }))).toEqual([]);
    expect(await errors(product())).toEqual([]);
  });

  it('validates every item: a positive amount, a 3-letter code, no stray fields', async () => {
    expect(await errors(product({ prices: [{ currencyCode: 'MRU', sellPrice: 0 }] }))).toEqual(['prices']);
    expect(await errors(product({ prices: [{ currencyCode: 'MRU', sellPrice: -5 }] }))).toEqual(['prices']);
    expect(await errors(product({ prices: [{ currencyCode: 'MRUU', sellPrice: 5 }] }))).toEqual(['prices']);
    expect(await errors(product({ prices: [{ currencyCode: 'MRU', sellPrice: '5x' }] }))).toEqual(['prices']);
    expect(await errors(product({ prices: [{ currencyCode: 'MRU', sellPrice: 5, isActive: false }] }))).toEqual(['prices']);
  });

  it('caps the list at 20 currencies', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ currencyCode: `C${String(i).padStart(2, '0')}`, sellPrice: 1 }));
    expect(await errors(product({ prices: many }))).toEqual(['prices']);
  });
});
