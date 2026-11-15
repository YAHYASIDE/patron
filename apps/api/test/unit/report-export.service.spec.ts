import { BadRequestException } from '@nestjs/common';
import { ReportExportService } from '../../src/modules/reports/report-export.service';
import { DateRangeDto } from '../../src/modules/reports/dto/report.dto';

function dateRange(partial: Partial<DateRangeDto> = {}): DateRangeDto {
  return Object.assign(new DateRangeDto(), partial);
}

describe('ReportExportService', () => {
  let reports: any;
  let analytics: any;
  let service: ReportExportService;

  beforeEach(() => {
    reports = {
      revenue: jest.fn(),
      profit: jest.fn(),
      productPerformance: jest.fn(),
      providerPerformance: jest.fn(),
      currencyBreakdown: jest.fn(),
      refundReport: jest.fn(),
      customerStats: jest.fn(),
    };
    analytics = {
      customerLifetimeValue: jest.fn(),
      failedOrders: jest.fn(),
    };
    service = new ReportExportService(reports, analytics);
  });

  describe('export', () => {
    it('rejects an unknown report and lists the available ones', async () => {
      await expect(service.export('nope', dateRange())).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.export('nope', dateRange())).rejects.toThrow(/Available: revenue, profit/);
    });

    it('unwraps a wrapped source (revenue -> .series) and renders CSV with a dated filename', async () => {
      reports.revenue.mockResolvedValue({
        series: [{ period: '2026-07-01', gross: '100' }],
      });

      const res = await service.export('revenue', dateRange({ from: '2026-07-01', to: '2026-07-31' }));

      expect(reports.revenue).toHaveBeenCalled();
      expect(res.filename).toBe('patron-revenue-2026-07-01-to-2026-07-31.csv');
      expect(res.csv).toContain('period,gross');
      expect(res.csv).toContain('2026-07-01,100');
      // BOM + CRLF framing.
      expect(res.csv.startsWith('﻿')).toBe(true);
      expect(res.csv.endsWith('\r\n')).toBe(true);
    });

    it('unwraps profit via .series', async () => {
      reports.profit.mockResolvedValue({ series: [{ period: '2026-07-01', profit: '40' }] });
      const res = await service.export('profit', dateRange());
      expect(res.csv).toContain('period,profit');
    });

    it('passes providers straight through', async () => {
      reports.providerPerformance.mockResolvedValue([{ provider: 'acme', calls: 10n }]);
      const res = await service.export('providers', dateRange());
      expect(res.csv).toContain('provider,calls');
    });

    it('passes currencies straight through', async () => {
      reports.currencyBreakdown.mockResolvedValue([{ currency: 'USD', orders: 9n }]);
      const res = await service.export('currencies', dateRange());
      expect(res.csv).toContain('currency,orders');
    });

    it('passes a bare-array source (products) straight through', async () => {
      const rows = [{ sku: 'A', units: 3n }];
      reports.productPerformance.mockResolvedValue(rows);

      const res = await service.export('products', dateRange());

      expect(res.csv).toContain('sku,units');
      expect(res.csv).toContain('A,3');
    });

    it('resolves refunds via .byReason', async () => {
      reports.refundReport.mockResolvedValue({ byReason: [{ reason: 'fraud', count: 2n }] });
      const res = await service.export('refunds', dateRange());
      expect(res.csv).toContain('reason,count');
      expect(res.csv).toContain('fraud,2');
    });

    it('resolves customers via .topCustomers', async () => {
      reports.customerStats.mockResolvedValue({ topCustomers: [{ email: 'a@b.c', spend_base: '400' }] });
      const res = await service.export('customers', dateRange());
      expect(res.csv).toContain('a@b.c,400');
    });

    it('resolves ltv via analytics cohorts', async () => {
      analytics.customerLifetimeValue.mockResolvedValue({ cohorts: [{ cohort: '2026-01', ltv: '99' }] });
      const res = await service.export('ltv', dateRange());
      expect(res.csv).toContain('cohort,ltv');
      expect(res.csv).toContain('2026-01,99');
    });

    it('resolves failures via analytics byRevenueLost', async () => {
      analytics.failedOrders.mockResolvedValue({ byRevenueLost: [{ sku: 'X', revenue_lost: '50' }] });
      const res = await service.export('failures', dateRange());
      expect(res.csv).toContain('sku,revenue_lost');
    });
  });

  describe('toCsv', () => {
    it('returns an empty string for no rows', () => {
      expect(service.toCsv([])).toBe('');
    });

    it('derives headers from the first row and joins with CRLF, BOM-prefixed', () => {
      const csv = service.toCsv([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]);
      expect(csv).toBe('﻿a,b\r\n1,2\r\n3,4\r\n');
    });

    it('honours an explicit column list and ordering', () => {
      const csv = service.toCsv([{ a: '1', b: '2', c: '3' }], ['c', 'a']);
      expect(csv).toBe('﻿c,a\r\n3,1\r\n');
    });
  });

  describe('escape (via toCsv)', () => {
    const csvBody = (value: unknown) =>
      service.toCsv([{ v: value }]).replace(/^﻿v\r\n/, '').replace(/\r\n$/, '');

    it('renders null and undefined as empty cells', () => {
      expect(csvBody(null)).toBe('');
      expect(csvBody(undefined)).toBe('');
    });

    it('normalises Date to ISO 8601', () => {
      expect(csvBody(new Date('2026-07-01T12:00:00.000Z'))).toBe('2026-07-01T12:00:00.000Z');
    });

    it('stringifies BigInt correctly', () => {
      expect(csvBody(123456789012345678901234567890n)).toBe('123456789012345678901234567890');
    });

    it('neutralises formula-injection payloads with a leading tab', () => {
      // Leading `=` -> tab-prefixed. The tab also makes it match nothing special
      // for quoting, so no surrounding quotes are added.
      expect(csvBody('=HYPERLINK("http://evil","x")')).toBe('"\t=HYPERLINK(""http://evil"",""x"")"');
      expect(csvBody('+1')).toBe('\t+1');
      expect(csvBody('-1')).toBe('\t-1');
      expect(csvBody('@cmd')).toBe('\t@cmd');
    });

    it('quotes and doubles embedded quotes / commas / newlines', () => {
      expect(csvBody('a,b')).toBe('"a,b"');
      expect(csvBody('say "hi"')).toBe('"say ""hi"""');
      expect(csvBody('line1\nline2')).toBe('"line1\nline2"');
    });

    it('leaves a plain value untouched', () => {
      expect(csvBody('plain')).toBe('plain');
    });
  });

  describe('filename', () => {
    it('formats as patron-<report>-<from>-to-<to>.csv using ISO dates', () => {
      const name = service.filename(
        'profit',
        new Date('2026-01-05T10:00:00.000Z'),
        new Date('2026-02-10T23:00:00.000Z'),
      );
      expect(name).toBe('patron-profit-2026-01-05-to-2026-02-10.csv');
    });
  });
});
