import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { ReportsService } from './reports.service';
import { AnalyticsService } from './analytics.service';
import { ReportExportService } from './report-export.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DateRangeDto } from './dto/report.dto';

@ApiBearerAuth()
@ApiTags('admin/reports')
@RequirePermissions('reports.read')
// Reports are the heaviest queries in the platform. The global 120/min limit is
// far too generous for something that can aggregate a year of orders; a
// dashboard refresh loop would otherwise be a self-inflicted DoS.
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private reports: ReportsService,
    private analytics: AnalyticsService,
    private exporter: ReportExportService,
  ) {}

  @ApiOperation({ summary: 'Operator dashboard — reads pre-aggregated daily metrics' })
  @Get('dashboard') dashboard() { return this.reports.dashboard(); }

  /** Fast path: pre-aggregated, refreshed nightly. Use for dashboards. */
  @Get('revenue') revenue(@Query() dto: DateRangeDto) { return this.reports.revenueFast(dto); }

  /** Exact, live figures straight from the source tables. Slower by design. */
  @ApiOperation({ summary: 'Revenue computed live rather than from the rollup' })
  @Throttle({ expensive: { limit: 5, ttl: 60_000 } })
  @Get('revenue/live') revenueLive(@Query() dto: DateRangeDto) { return this.reports.revenue(dto); }

  @Get('profit') profit(@Query() dto: DateRangeDto) { return this.reports.profit(dto); }

  @Get('providers') providers(@Query() dto: DateRangeDto) { return this.reports.providerPerformance(dto); }

  @Get('providers/fulfilment') providerFulfilment(@Query() dto: DateRangeDto) {
    return this.reports.providerFulfilment(dto);
  }

  @Get('products') products(@Query() dto: DateRangeDto) { return this.reports.productPerformance(dto); }

  @Get('customers') customers(@Query() dto: DateRangeDto) { return this.reports.customerStats(dto); }

  @Get('currencies') currencies(@Query() dto: DateRangeDto) { return this.reports.currencyBreakdown(dto); }

  @Get('refunds') refunds(@Query() dto: DateRangeDto) { return this.reports.refundReport(dto); }

  @Get('failures') failures(@Query() dto: DateRangeDto) { return this.reports.failureAnalysis(dto); }

  @Get('queues') queues() { return this.reports.queueStats(); }

  // ── analytics ──

  @Get('trends') trends(@Query() dto: DateRangeDto) { return this.analytics.trends(dto); }

  @Get('profitability') profitability(@Query() dto: DateRangeDto) {
    return this.analytics.profitability(dto);
  }

  @Get('providers/comparison') providerComparison(@Query() dto: DateRangeDto) {
    return this.analytics.providerComparison(dto);
  }

  @Get('customers/ltv') ltv(@Query() dto: DateRangeDto) {
    return this.analytics.customerLifetimeValue(dto);
  }

  @Get('failures/orders') failedOrders(@Query() dto: DateRangeDto) {
    return this.analytics.failedOrders(dto);
  }

  /**
   * CSV export. Streamed as an attachment rather than returned as JSON for the
   * client to convert — finance teams live in spreadsheets, and a
   * browser-side conversion is one more place to get encoding wrong.
   */
  @ApiOperation({ summary: 'Export a report as CSV' })
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Export a report as CSV',
    description: 'UTF-8 with BOM, CRLF line endings, and formula-injection escaping for Excel.',
  })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Export a report as CSV' })
  @Throttle({ expensive: { limit: 5, ttl: 60_000 } })
  @Get('export/:report')
  @Header('content-type', 'text/csv; charset=utf-8')
  async export(
    @Param('report') report: string,
    @Query() dto: DateRangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { from, to } = dto.resolve();

    const sources: Record<string, () => Promise<unknown>> = {
      revenue: async () => (await this.reports.revenue(dto)).series,
      profit: async () => (await this.reports.profit(dto)).series,
      products: () => this.reports.productPerformance(dto),
      providers: () => this.reports.providerPerformance(dto),
      currencies: () => this.reports.currencyBreakdown(dto),
      refunds: async () => (await this.reports.refundReport(dto)).byReason,
      customers: async () => (await this.reports.customerStats(dto)).topCustomers,
      ltv: async () => (await this.analytics.customerLifetimeValue(dto)).cohorts,
      failures: async () => (await this.analytics.failedOrders(dto)).byRevenueLost,
    };

    const source = sources[report];
    if (!source) {
      res.status(400);
      return `Unknown report "${report}". Available: ${Object.keys(sources).join(', ')}`;
    }

    const rows = (await source()) as Array<Record<string, unknown>>;
    res.setHeader('content-disposition', `attachment; filename="${this.exporter.filename(report, from, to)}"`);
    return this.exporter.toCsv(rows);
  }
}
