import { Injectable } from '@nestjs/common';

/**
 * CSV export.
 *
 * Deliberately not a library. The requirements are narrow — escape correctly,
 * stream, and do not corrupt data in Excel — and the last of those is where
 * generic libraries get it wrong.
 */
@Injectable()
export class ReportExportService {
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
