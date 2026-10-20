import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export const INBOX_STATES = ['open', 'all', 'resolved'] as const;
export type InboxState = (typeof INBOX_STATES)[number];

/** `domain.event`, e.g. order.failed or bank.unmatched. */
export const NOTICE_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

export class InboxQueryDto {
  @ApiPropertyOptional({ enum: INBOX_STATES, default: 'open' })
  @IsOptional() @IsIn(INBOX_STATES) state?: InboxState;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class InboxPrefsDto {
  @ApiProperty({ type: [String], description: 'Notification types this staff member does not want to see' })
  @IsArray() @ArrayMaxSize(50)
  @IsString({ each: true })
  @Matches(NOTICE_TYPE_PATTERN, { each: true, message: 'each muted type looks like domain.event' })
  muted!: string[];
}
