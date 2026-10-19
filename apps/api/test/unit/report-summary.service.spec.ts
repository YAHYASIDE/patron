import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import {
  CARD_LABEL, OTHER_LABEL, ReportSummaryService, TRANSFER_LABEL, WALLET_LABEL,
} from '../../src/modules/reports/summary.service';
import { ReportSummaryController } from '../../src/modules/reports/summary.controller';
import { ReportSummaryQueryDto } from '../../src/modules/reports/dto/summary.dto';
import { PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';

const NOW = new Date('2026-10-19T13:00:00.000Z');
const TODAY = new Date('2026-10-19T00:00:00.000Z');
const query = (plain: object = {}) => plainToInstance(ReportSummaryQueryDto, plain);

type Rows = Partial<Record<'days' | 'today' | 'methods' | 'todayMethods' | 'customers' | 'products' | 'countries' | 'losses', unknown[]>>;

/** $queryRaw is a tagged template: route each call by the SQL it carries (and today's calls by their start). */
const raw = (rows: Rows) =>
  jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    const start = values.find((v): v is Date => v instanceof Date);
    const isToday = start?.getTime() === TODAY.getTime();
    if (sql.includes('"owedValue"')) return Promise.resolve(rows.losses ?? []);
    if (sql.includes('"belowUnits"')) return Promise.resolve(rows.products ?? []);
    if (sql.includes('"payments"')) return Promise.resolve((isToday ? rows.todayMethods : rows.methods) ?? []);
    if (sql.includes('LIMIT 10')) return Promise.resolve(rows.customers ?? []);
    if (sql.includes('date_trunc')) return Promise.resolve((isToday ? rows.today : rows.days) ?? []);
    return Promise.resolve(rows.countries ?? []);
  });

describe('ReportSummaryService', () => {
  let prisma: any;
  let service: ReportSummaryService;

  beforeEach(() => {
    prisma = {
      $queryRaw: raw({}),
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue({
          value: [
            { id: 'om-ml', method: 'Orange Money', logo: 'upload:abc', enabled: false },
            { id: 'om', method: 'Orange Money', logo: 'orange', enabled: true },
            { id: 'bankily', method: 'Bankily', logo: 'bankily', enabled: true },
            { id: 'nologo', method: 'Klic', enabled: true },
          ],
        }),
      },
    };
    service = new ReportSummaryService(prisma);
  });

  it('adds up the period, fills every day and reports today like the dashboard home', async () => {
    prisma.$queryRaw = raw({
      days: [
        { day: new Date('2026-10-17T00:00:00Z'), orders: 2, revenue: '10', cost: '8.5', delivered: 3 },
        { day: TODAY, orders: 1, revenue: '5.25', cost: '6', delivered: 1 },
      ],
      today: [{ day: TODAY, orders: 1, revenue: '5.25', cost: '6', delivered: 1 }],
    });

    const r = await service.summary(query({ from: '2026-10-16', to: '2026-10-19' }), NOW);

    expect(r.range).toEqual({ from: new Date('2026-10-16T00:00:00Z'), to: new Date('2026-10-20T00:00:00Z') });
    expect(r.totals).toEqual({
      revenue: '15.25', cost: '14.50', profit: '0.75', marginPercent: 4.9,
      orders: 3, itemsDelivered: 4, averageOrder: '5.08',
    });
    expect(r.series.map((d) => d.date)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']);
    expect(r.series[0]).toEqual({ date: '2026-10-16', revenue: '0.00', cost: '0.00', profit: '0.00', orders: 0 });
    expect(r.series[1]).toEqual({ date: '2026-10-17', revenue: '10.00', cost: '8.50', profit: '1.50', orders: 2 });
    expect(r.series[3].profit).toBe('-0.75');
    expect(r.today).toEqual({ revenue: '5.25', cost: '6.00', profit: '-0.75', orders: 1, cashByMethod: [], walletUsed: { amount: '0.00', orders: 0 } });
  });

  it('names the payment apps, groups transfers by app and gives each its share and logo', async () => {
    prisma.$queryRaw = raw({
      days: [{ day: TODAY, orders: 10, revenue: '100', cost: '80', delivered: 10 }],
      methods: [
        { key: 'm:bankily', gateway: 'MANUAL', name: 'Bankily', orders: 6, revenue: '60' },
        { key: 'm:orange money', gateway: 'MANUAL', name: 'Orange Money', orders: 1, revenue: '15' },
        { key: 'wallet', gateway: 'WALLET', name: null, orders: 1, revenue: '12.5' },
        { key: 'card', gateway: 'STRIPE', name: null, orders: 1, revenue: '10' },
        { key: 'm:', gateway: 'MANUAL', name: null, orders: 1, revenue: '2.5' },
        { key: 'other', gateway: null, name: null, orders: 0, revenue: '0' },
      ],
      todayMethods: [
        { key: 'm:klic', gateway: 'MANUAL', name: 'Klic', orders: 2, revenue: '7.1' },
        { key: 'wallet', gateway: 'WALLET', name: null, orders: 3, revenue: '9' },
      ],
    });

    const r = await service.summary(query(), NOW);

    expect(r.byMethod).toEqual([
      { method: 'Bankily', gateway: 'MANUAL', logo: 'bankily', orders: 6, revenue: '60.00', share: 60 },
      // the switched-on account's logo wins over a switched-off one with the same name
      { method: 'Orange Money', gateway: 'MANUAL', logo: 'orange', orders: 1, revenue: '15.00', share: 15 },
      { method: WALLET_LABEL, gateway: 'WALLET', logo: null, orders: 1, revenue: '12.50', share: 12.5 },
      { method: CARD_LABEL, gateway: 'CARD', logo: null, orders: 1, revenue: '10.00', share: 10 },
      { method: TRANSFER_LABEL, gateway: 'MANUAL', logo: null, orders: 1, revenue: '2.50', share: 2.5 },
      { method: OTHER_LABEL, gateway: 'OTHER', logo: null, orders: 0, revenue: '0.00', share: 0 },
    ]);
    // the wallet spends a balance received earlier: it is not cash that came in today
    expect(r.today.cashByMethod).toEqual([
      { method: 'Klic', gateway: 'MANUAL', logo: null, amount: '7.10', orders: 2 },
    ]);
    expect(r.today.walletUsed).toEqual({ amount: '9.00', orders: 3 });
  });

  it('ranks best sellers by units and lists sales below cost, largest loss first', async () => {
    prisma.$queryRaw = raw({
      products: [
        { productId: 'a', sku: 'A', nameAr: 'أ', units: 3, revenue: '30', profit: '3', belowUnits: 0, belowLoss: '0' },
        { productId: 'b', sku: 'B', nameAr: 'ب', units: 5, revenue: '10', profit: '-1.5', belowUnits: 2, belowLoss: '1.5' },
        { productId: 'c', sku: 'C', nameAr: 'ج', units: 5, revenue: '20', profit: '1', belowUnits: 1, belowLoss: '0.25' },
      ],
      losses: [{ refunds: '4', refundCount: 2, owedCount: 1, owedValue: '2.5' }],
    });

    const r = await service.summary(query(), NOW);

    expect(r.topProducts.map((p) => p.productId)).toEqual(['c', 'b', 'a']);
    expect(r.topProducts[1]).toEqual({ productId: 'b', sku: 'B', nameAr: 'ب', units: 5, revenue: '10.00', profit: '-1.50' });
    expect(r.losses).toEqual({
      refunds: '4.00',
      refundCount: 2,
      belowCost: [
        { productId: 'b', sku: 'B', nameAr: 'ب', units: 2, loss: '1.50' },
        { productId: 'c', sku: 'C', nameAr: 'ج', units: 1, loss: '0.25' },
      ],
      belowCostTotal: '1.75',
      owed: { count: 1, value: '2.50' },
      // refunds are already off the sales and owed money is not lost: only sales under cost are
      total: '1.75',
    });
  });

  it('formats best customers and countries', async () => {
    const last = new Date('2026-10-18T10:00:00Z');
    prisma.$queryRaw = raw({
      customers: [{ id: 'u1', fullName: 'Sidi', phone: '+222', country: 'MR', orders: 2, spent: '7.5', profit: '1.125', lastOrderAt: last }],
      countries: [{ country: 'MR', orders: 2, revenue: '7.5' }, { country: null, orders: 1, revenue: '1' }],
    });

    const r = await service.summary(query(), NOW);

    expect(r.topCustomers).toEqual([
      { id: 'u1', fullName: 'Sidi', phone: '+222', country: 'MR', orders: 2, spent: '7.50', profit: '1.13', lastOrderAt: last },
    ]);
    expect(r.byCountry).toEqual([{ country: 'MR', orders: 2, revenue: '7.50' }, { country: null, orders: 1, revenue: '1.00' }]);
  });

  it('answers zeros for a period without sales (default: this month so far)', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(null);

    const r = await service.summary(query(), NOW);

    expect(r.range).toEqual({ from: new Date('2026-10-01T00:00:00Z'), to: NOW });
    expect(r.series).toHaveLength(19);
    expect(r.totals).toEqual({
      revenue: '0.00', cost: '0.00', profit: '0.00', marginPercent: 0, orders: 0, itemsDelivered: 0, averageOrder: '0.00',
    });
    expect(r.today).toEqual({ revenue: '0.00', cost: '0.00', profit: '0.00', orders: 0, cashByMethod: [], walletUsed: { amount: '0.00', orders: 0 } });
    expect(r.losses).toMatchObject({ refunds: '0.00', belowCost: [], owed: { count: 0, value: '0.00' }, total: '0.00' });
    expect(r).toMatchObject({ byMethod: [], topCustomers: [], topProducts: [], byCountry: [] });
  });

  it('counts paid orders exactly like InsightsService and binds the dates as parameters', async () => {
    await service.summary(query({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }), NOW);

    const calls = prisma.$queryRaw.mock.calls as Array<[TemplateStringsArray, ...unknown[]]>;
    expect(calls).toHaveLength(8);
    const days = calls.find(([s]) => s.join('?').includes('date_trunc'))!;
    const paid = days.slice(1).find((v: any) => v?.strings?.join('').includes('PENDING_PAYMENT')) as any;
    expect(paid.strings.join('')).toContain(`o."status" NOT IN ('PENDING_PAYMENT', 'CANCELLED', 'FAILED', 'REFUNDED')`);
    expect(days).toContainEqual(new Date('2026-10-01T00:00:00Z'));
    expect(days).toContainEqual(new Date('2026-10-02T00:00:00Z'));
  });

  it('rejects a bad period before touching the database', async () => {
    await expect(service.summary(query({ from: '2026-10-05', to: '2026-10-01' }), NOW)).rejects.toThrow(BadRequestException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('ReportSummaryQueryDto', () => {
  const errors = async (plain: object) =>
    (await validate(query(plain), { whitelist: true, forbidNonWhitelisted: true })).map((e) => e.property);

  it('takes optional ISO dates and nothing else', async () => {
    expect(await errors({})).toEqual([]);
    expect(await errors({ from: '2026-10-01', to: '2026-10-19T23:00:00.000Z' })).toEqual([]);
    expect(await errors({ from: 'yesterday', to: '2026-13-45' })).toEqual(['from', 'to']);
    expect(await errors({ granularity: 'day' })).toEqual(['granularity']);
  });

  it('defaults to this month (UTC) up to now', () => {
    expect(query().resolve(NOW)).toEqual({ from: new Date('2026-10-01T00:00:00Z'), to: NOW });
  });

  it('includes the whole day of a bare `to` date, but takes a timestamp as given', () => {
    expect(query({ from: '2026-10-01', to: '2026-10-01' }).resolve(NOW).to).toEqual(new Date('2026-10-02T00:00:00Z'));
    expect(query({ from: '2026-10-01', to: '2026-10-01T12:00:00Z' }).resolve(NOW).to).toEqual(new Date('2026-10-01T12:00:00Z'));
  });

  it('refuses an empty, reversed or over-long period', () => {
    expect(() => query({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T00:00:00Z' }).resolve(NOW)).toThrow(BadRequestException);
    expect(() => query({ from: '2026-10-05', to: '2026-10-01' }).resolve(NOW)).toThrow('`from` must be before `to`');
    expect(() => query({ from: '2025-01-01', to: '2026-10-01' }).resolve(NOW)).toThrow('cannot exceed 400 days');
  });
});

describe('ReportSummaryController', () => {
  it('delegates to the service with the query', () => {
    const summaries = { summary: jest.fn().mockReturnValue('s') };
    const controller = new ReportSummaryController(summaries as any);
    const q = query();
    expect(controller.summary(q)).toBe('s');
    expect(summaries.summary).toHaveBeenCalledWith(q);
  });

  it('needs reports.read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ReportSummaryController)).toEqual(['reports.read']);
  });
});
