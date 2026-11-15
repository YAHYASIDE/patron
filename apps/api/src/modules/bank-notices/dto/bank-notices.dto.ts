import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';

export const BANK_NOTICE_STATUSES = ['NEW', 'SUGGESTED', 'CONFIRMED', 'IGNORED', 'DUPLICATE'] as const;
/** An Android package name, e.g. mr.bankily.app. */
export const APP_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{1,127}$/;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class IngestBankNoticeDto {
  @ApiProperty({ description: 'The admin phone that read the notification' })
  @Transform(trim) @IsString() @Length(1, 128) deviceId!: string;

  @ApiProperty({ description: 'Package name of the bank app', example: 'mr.bankily.app' })
  @Transform(trim) @IsString() @Matches(APP_ID_PATTERN) sourceApp!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) title?: string;

  @ApiProperty({ maxLength: 4000, description: 'Notification text; one-time codes are removed before storing' })
  @IsString() @Length(1, 4000) text!: string;

  @ApiProperty({ description: 'When the phone received it (ISO 8601)' })
  @IsISO8601({ strict: true }) postedAt!: string;
}

export class BankNoticesQueryDto {
  @ApiPropertyOptional({ enum: BANK_NOTICE_STATUSES })
  @IsOptional() @IsIn(BANK_NOTICE_STATUSES) status?: (typeof BANK_NOTICE_STATUSES)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ConfirmBankNoticeDto {
  @ApiProperty({ description: 'The manual payment this notice is evidence for (approve it separately)' })
  @IsUUID() paymentId!: string;
}

export class IgnoreBankNoticeDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}

export class BankConfigDto {
  @ApiProperty({ type: [String], description: 'Package names of the bank apps the phone may forward' })
  @IsArray() @ArrayMaxSize(30)
  @IsString({ each: true }) @Matches(APP_ID_PATTERN, { each: true, message: 'each app is an Android package name' })
  allowedApps!: string[];
}
