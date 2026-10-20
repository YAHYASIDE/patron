import { BadRequestException } from '@nestjs/common';
import { IsISO8601, IsOptional } from 'class-validator';

const DAY_MS = 86_400_000;
const MAX_DAYS = 400;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `GET /admin/reports/summary?from&to`: the period of the owner's reports page.
 *
 * The range is half-open, [from, to). A bare date for `to` ("2026-10-19")
 * includes that whole day, which is what a person typing two dates means.
 * Both omitted: this month (UTC) up to now.
 */
export class ReportSummaryQueryDto {
  @IsOptional() @IsISO8601({ strict: true }) from?: string;
  @IsOptional() @IsISO8601({ strict: true }) to?: string;

  resolve(now = new Date()): { from: Date; to: Date } {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const from = this.from ? new Date(this.from) : monthStart;
    let to = this.to ? new Date(this.to) : now;
    if (this.to && DATE_ONLY.test(this.to)) to = new Date(to.getTime() + DAY_MS);

    if (from >= to) throw new BadRequestException('`from` must be before `to`');
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_DAYS} days`);
    }
    return { from, to };
  }
}
