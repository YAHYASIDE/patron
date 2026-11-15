import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches } from 'class-validator';

/** What the store and the dashboard may report (docs/api-contract-feedback.md). */
export const EVENT_KINDS = ['search_miss', 'brand_view', 'suggestion', 'client_error'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ReportEventDto {
  @ApiProperty({ enum: EVENT_KINDS })
  @IsIn(EVENT_KINDS) kind!: EventKind;

  @ApiProperty({ minLength: 1, maxLength: 300, description: 'The search text, brand key, suggestion or error message' })
  @Transform(trim) @IsString() @Length(1, 300) value!: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'The page path, e.g. /checkout' })
  @IsOptional() @IsString() @Length(1, 200) @Matches(/^\//) path?: string;

  @ApiPropertyOptional({ description: 'Per kind: { title } | { contact } | { app, stack, ua }' })
  @IsOptional() @IsObject() detail?: Record<string, unknown>;
}

export class PeriodQueryDto {
  @ApiPropertyOptional({ enum: [1, 7, 30, 90] })
  @IsOptional() @Type(() => Number) @IsInt() @IsIn([1, 7, 30, 90]) days?: number;
}
