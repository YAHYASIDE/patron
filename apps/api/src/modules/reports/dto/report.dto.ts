import { BadRequestException } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export enum Granularity {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class DateRangeDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(Granularity) granularity: Granularity = Granularity.DAY;

  /** Report in a single currency; omitted means base currency. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 20;

  /**
   * Defaults to the last 30 days. An unbounded report is a full table scan
   * that will eventually take the database down at 3pm on a Monday.
   */
  resolve(): { from: Date; to: Date } {
    const to = this.to ? new Date(this.to) : new Date();
    const from = this.from ? new Date(this.from) : new Date(to.getTime() - 30 * 864e5);

    // BadRequestException, not Error. AnalyticsService calls resolve()
    // directly, so a raw Error surfaced as a 500 for what is a user mistake.
    if (from > to) throw new BadRequestException('`from` must be before `to`');

    const MAX_DAYS = 400;
    if ((to.getTime() - from.getTime()) / 864e5 > MAX_DAYS) {
      throw new BadRequestException(`Date range cannot exceed ${MAX_DAYS} days`);
    }
    return { from, to };
  }
}
