import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AuditQueryDto, BroadcastDto, BulkPriceDto, CreateCouponDto, OrderNoteDto, UpdateCouponDto, UpdateCustomerDto,
  WhatsappTemplatesDto,
} from '../../src/modules/admin-tools/admin-tools.dto';
import { OverviewQueryDto } from '../../src/modules/insights/insights.dto';
import { QueryOrdersDto } from '../../src/modules/orders/dto/order.dto';

/** The global ValidationPipe runs with whitelist + forbidNonWhitelisted. */
const errors = async (cls: new () => object, plain: object) =>
  (await validate(plainToInstance(cls, plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

describe('owner DTOs', () => {
  it('order note: a string up to 1000 or null, but required', async () => {
    expect(await errors(OrderNoteDto, { note: 'x' })).toEqual([]);
    expect(await errors(OrderNoteDto, { note: null })).toEqual([]);
    expect(await errors(OrderNoteDto, {})).toEqual(['note']);
    expect(await errors(OrderNoteDto, { note: 'x'.repeat(1001) })).toEqual(['note']);
  });

  it('customer patch: note ≤ 1000 or null, at most 10 tags of ≤ 20 chars', async () => {
    expect(await errors(UpdateCustomerDto, { adminNote: null, tags: ['VIP', 'watch'] })).toEqual([]);
    expect(await errors(UpdateCustomerDto, { tags: Array(11).fill('a') })).toEqual(['tags']);
    expect(await errors(UpdateCustomerDto, { tags: ['x'.repeat(21)] })).toEqual(['tags']);
    expect(await errors(UpdateCustomerDto, { fullName: 'x' })).toEqual(['fullName']);
  });

  it('coupon: code shape, type and positive value; update is partial', async () => {
    expect(await errors(CreateCouponDto, { code: 'EID-10', discountType: 'PERCENT', discountValue: 10, maxUses: null })).toEqual([]);
    expect(await errors(CreateCouponDto, { code: 'a b', discountType: 'HALF', discountValue: 0 })).toEqual(
      ['code', 'discountType', 'discountValue'],
    );
    expect(await errors(UpdateCouponDto, { isActive: false })).toEqual([]);
    expect(await errors(UpdateCouponDto, { usedCount: 0 })).toEqual(['usedCount']);
  });

  it('quick replies: at most 20, each with a title and body', async () => {
    expect(await errors(WhatsappTemplatesDto, { templates: [{ title: 't', body: 'b {name}' }] })).toEqual([]);
    expect(await errors(WhatsappTemplatesDto, { templates: Array(21).fill({ title: 't', body: 'b' }) })).toEqual(['templates']);
    expect(await errors(WhatsappTemplatesDto, { templates: [{ title: '', body: 'b' }] })).toEqual(['templates']);
  });

  it('broadcast: Arabic required, link a store path or https, country alpha-2', async () => {
    expect(await errors(BroadcastDto, { titleAr: 'عرض', bodyAr: 'نص', link: '/products', country: 'MR' })).toEqual([]);
    expect(await errors(BroadcastDto, { titleAr: 'عرض', bodyAr: 'نص', link: 'javascript:alert(1)' })).toEqual(['link']);
    expect(await errors(BroadcastDto, { titleAr: 'عرض', bodyAr: 'نص', country: 'mr' })).toEqual(['country']);
    expect(await errors(BroadcastDto, { bodyAr: 'نص' })).toEqual(['titleAr']);
  });

  it('bulk price: percent within −50…100 and dryRun required', async () => {
    expect(await errors(BulkPriceDto, { percent: -50, dryRun: true })).toEqual([]);
    expect(await errors(BulkPriceDto, { percent: 101, dryRun: false })).toEqual(['percent']);
    expect(await errors(BulkPriceDto, { percent: 5 })).toEqual(['dryRun']);
    expect(await errors(BulkPriceDto, { percent: 5, dryRun: true, productIds: ['nope'] })).toEqual(['productIds']);
  });

  it('query DTOs coerce numbers and check the new order filters', async () => {
    expect(await errors(AuditQueryDto, { limit: '50', action: 'catalog.' })).toEqual([]);
    const overview = plainToInstance(OverviewQueryDto, { lowStock: '2' });
    expect(overview).toMatchObject({ lowStock: 2, margin: 5 });
    expect(await errors(OverviewQueryDto, { margin: '150' })).toEqual(['margin']);
    expect(await errors(QueryOrdersDto, { gateway: 'MANUAL', country: 'MR', from: '2026-10-01', to: '2026-10-19' })).toEqual([]);
    expect(await errors(QueryOrdersDto, { gateway: 'CASH', country: 'Mauritania', from: 'yesterday' })).toEqual(
      ['gateway', 'country', 'from'],
    );
  });
});
