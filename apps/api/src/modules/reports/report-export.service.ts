import { BadRequestException, Injectable } from '@nestjs/common';

import { ReportsService } from './reports.service';
import { AnalyticsService } from './analytics.service';
import { DateRangeDto } from './dto/report.dto';

/**
 * CSV export.
 *
 * Deliberately not a library. The requirements are narrow — escape correctly,
 * stream, and do not corrupt data in Excel — and the last of those is where
 * generic libraries get it wrong.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private reports: ReportsService,
    private analytics: AnalyticsService,
  ) {}

  /**
   * Resolve a report name to its rows and render them as CSV. The
   * report→source mapping and unknown-report handling live here rather than in
   * the controller, which now only wires the HTTP response.
   */
  async export(report: string, dto: DateRangeDto): Promise<{ filename: string; csv: string }> {
    const { from, to } = dto.resolve();
    const sources = this.sources(dto);
    const source = sources[report];
    if (!source) {
      throw new BadRequestException(
        `Unknown report "${report}". Available: ${Object.keys(sources).join(', ')}`,
      );
    }

    const rows = (await source()) as Array<Record<string, unknown>>;
    return { filename: this.filename(report, from, to), csv: this.toCsv(rows) };
  }

  /** The set of exportable reports and how each maps onto a service call. */
  private sources(dto: DateRangeDto): Record<string, () => Promise<unknown>> {
    return {
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
  }

  toCsv(rows: Array<Record<string, unknown>>, columns?: string[]): string {
    if (rows.length === 0) return '';
    const headers = columns ?? Object.keys(rows[0]);

    const lines = [
      headers.join(','),
      ...rows.map((row) => headers.map((h) => this.escape(row[h])).join(',')),
    ];

    // BOM so Excel reads UTF-8 — without it, Arabic product names arrive as
    // mojibake and someone concludes the export is broken.
    return `\uFEFF${lines.join('\r\n')}\r\n`;
  }

  private escape(value: unknown): string {
    if (value === null || value === undefined) return '';

    // BigInt (from COUNT) and Decimal both stringify correctly; Date is
    // normalised to ISO so spreadsheets parse it unambiguously.
    let text = value instanceof Date ? value.toISOString() : String(value);

    /**
     * Formula injection: a cell starting with = + - or @ is executed by Excel
     * and Google Sheets. A product name of `=HYPERLINK("http://evil","click")`
     * would run on the finance team's machine. Prefixing with a tab neutralises
     * it while remaining readable.
     */
    if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;

    if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  }

  filename(report: string, from: Date, to: Date) {
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return `patron-${report}-${iso(from)}-to-${iso(to)}.csv`;
  }
}
