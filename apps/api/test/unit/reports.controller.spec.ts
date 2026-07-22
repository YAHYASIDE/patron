import { ReportsController } from '../../src/modules/reports/reports.controller';
import { DateRangeDto } from '../../src/modules/reports/dto/report.dto';

describe('ReportsController', () => {
  let reports: any;
  let analytics: any;
  let exporter: any;
  let controller: ReportsController;

  const dto = new DateRangeDto();

  beforeEach(() => {
    reports = {
      dashboard: jest.fn().mockResolvedValue('dashboard'),
      revenueFast: jest.fn().mockResolvedValue('revenueFast'),
      revenue: jest.fn().mockResolvedValue('revenue'),
      profit: jest.fn().mockResolvedValue('profit'),
      providerPerformance: jest.fn().mockResolvedValue('providers'),
      providerFulfilment: jest.fn().mockResolvedValue('providerFulfilment'),
      productPerformance: jest.fn().mockResolvedValue('products'),
      customerStats: jest.fn().mockResolvedValue('customers'),
      currencyBreakdown: jest.fn().mockResolvedValue('currencies'),
      refundReport: jest.fn().mockResolvedValue('refunds'),
      failureAnalysis: jest.fn().mockResolvedValue('failures'),
      queueStats: jest.fn().mockResolvedValue('queues'),
    };
    analytics = {
      trends: jest.fn().mockResolvedValue('trends'),
      profitability: jest.fn().mockResolvedValue('profitability'),
      providerComparison: jest.fn().mockResolvedValue('comparison'),
      customerLifetimeValue: jest.fn().mockResolvedValue('ltv'),
      failedOrders: jest.fn().mockResolvedValue('failedOrders'),
    };
    exporter = { export: jest.fn() };
    controller = new ReportsController(reports, analytics, exporter);
  });

  it('dashboard delegates to reports.dashboard', () => {
    expect(controller.dashboard()).toBe(reports.dashboard.mock.results[0].value);
    expect(reports.dashboard).toHaveBeenCalledTimes(1);
  });

  it('revenue uses the fast (rollup) path', () => {
    controller.revenue(dto);
    expect(reports.revenueFast).toHaveBeenCalledWith(dto);
  });

  it('revenueLive uses the live path', () => {
    controller.revenueLive(dto);
    expect(reports.revenue).toHaveBeenCalledWith(dto);
  });

  it.each([
    ['profit', 'profit'],
    ['providers', 'providerPerformance'],
    ['providerFulfilment', 'providerFulfilment'],
    ['products', 'productPerformance'],
    ['customers', 'customerStats'],
    ['currencies', 'currencyBreakdown'],
    ['refunds', 'refundReport'],
    ['failures', 'failureAnalysis'],
  ])('%s delegates to reports.%s with the dto', (method, target) => {
    (controller as any)[method](dto);
    expect(reports[target]).toHaveBeenCalledWith(dto);
  });

  it('queues delegates to reports.queueStats', () => {
    controller.queues();
    expect(reports.queueStats).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['trends', 'trends'],
    ['profitability', 'profitability'],
    ['providerComparison', 'providerComparison'],
    ['ltv', 'customerLifetimeValue'],
    ['failedOrders', 'failedOrders'],
  ])('%s delegates to analytics.%s with the dto', (method, target) => {
    (controller as any)[method](dto);
    expect(analytics[target]).toHaveBeenCalledWith(dto);
  });

  describe('export', () => {
    it('sets the content-disposition attachment header and returns the CSV body', async () => {
      exporter.export.mockResolvedValue({ filename: 'patron-revenue.csv', csv: '﻿a,b\r\n' });
      const res = { setHeader: jest.fn() } as any;

      const body = await controller.export('revenue', dto, res);

      expect(exporter.export).toHaveBeenCalledWith('revenue', dto);
      expect(res.setHeader).toHaveBeenCalledWith(
        'content-disposition',
        'attachment; filename="patron-revenue.csv"',
      );
      expect(body).toBe('﻿a,b\r\n');
    });

    it('propagates an exporter error (e.g. unknown report) without setting headers', async () => {
      exporter.export.mockRejectedValue(new Error('Unknown report'));
      const res = { setHeader: jest.fn() } as any;

      await expect(controller.export('bogus', dto, res)).rejects.toThrow('Unknown report');
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });
});
