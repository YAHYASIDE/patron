/**
 * CSV for the owner's spreadsheets, escaped the way ReportExportService does
 * it: UTF-8 BOM (Excel reads Arabic correctly), CRLF lines, quoted cells, and a
 * leading tab before = + - @ so a customer's name can never run as a formula.
 * Unlike the report export, an empty list still gives the header row.
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((cells) => cells.map(escapeCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `\t${text}`;
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}
