import { BadRequestException, Injectable } from '@nestjs/common';

import { ReportsService } from './reports.service';
import { AnalyticsService } from './analytics.service';
import { DateRangeDto } from './dto/report.dto';

/** The exportable report names, listed back to the caller on an unknown report. */
const REPORT_NAMES = [
  'revenue',
  'profit',
  'products',
  'providers',
  'currencies',
  'refunds',
  'customers',
  'ltv',
  'failures',
] as const;

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
    const rows = (await this.rowsFor(report, dto)) as Array<Record<string, unknown>>;
    return { filename: this.filename(report, from, to), csv: this.toCsv(rows) };
  }

  /**
   * Map a report name to its rows. A static `switch` rather than dynamic
   * dispatch on a user-supplied key: the report name never selects a method to
   * call, so it can neither reach an inherited member nor invoke an unintended
   * target — every branch is a fixed call decided at author time.
   */
  private async rowsFor(report: string, dto: DateRangeDto): Promise<unknown> {
    switch (report) {
      case 'revenue':
        return (await this.reports.revenue(dto)).series;
      case 'profit':
        return (await this.reports.profit(dto)).series;
      case 'products':
        return this.reports.productPerformance(dto);
      case 'providers':
        return this.reports.providerPerformance(dto);
      case 'currencies':
        return this.reports.currencyBreakdown(dto);
      case 'refunds':
        return (await this.reports.refundReport(dto)).byReason;
      case 'customers':
        return (await this.reports.customerStats(dto)).topCustomers;
      case 'ltv':
        return (await this.analytics.customerLifetimeValue(dto)).cohorts;
      case 'failures':
        return (await this.analytics.failedOrders(dto)).byRevenueLost;
      default:
        throw new BadRequestException(
          `Unknown report "${report}". Available: ${REPORT_NAMES.join(', ')}`,
        );
    }
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
