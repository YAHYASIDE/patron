import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length,
  Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);

export class CreateAgentDto {
  @ApiPropertyOptional({ description: 'An existing account to make an agent' })
  @ValidateIf((o: CreateAgentDto) => !o.phone) @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ example: '+22222123456', description: 'Or a WhatsApp number: its account, made if new' })
  @ValidateIf((o: CreateAgentDto) => !o.userId) @IsString() @Matches(E164, { message: 'Phone must be E.164, e.g. +22212345678' })
  phone?: string;

  @ApiPropertyOptional({ description: 'Needed when the number has no account yet' })
  @IsOptional() @IsString() @Length(2, 80)
  fullName?: string;

  @ApiPropertyOptional({ example: 'SIDI24', description: '4-12 letters/digits; generated when omitted' })
  @IsOptional() @Transform(upper) @IsString() @Matches(/^[A-Z0-9]{4,12}$/, { message: 'code must be 4-12 letters or digits' })
  code?: string;

  @ApiProperty({ enum: ['PERCENT', 'FIXED'] })
  @IsIn(['PERCENT', 'FIXED'])
  commissionType!: 'PERCENT' | 'FIXED';

  @ApiProperty({ description: 'Percent (0-100] of the net order value, or a fixed base-currency amount per order' })
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(100000)
  commissionValue!: number;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class UpdateAgentDto {
  @IsOptional() @IsIn(['PERCENT', 'FIXED'])
  commissionType?: 'PERCENT' | 'FIXED';

  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(100000)
  commissionValue?: number;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(500)
  note?: string | null;
}

export class QueryAgentsDto {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['true', 'false'])
  active?: 'true' | 'false';
}

export class RecordPayoutDto {
  @ApiProperty({ description: 'EARNED commissions this payout settles' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique() @IsUUID('all', { each: true })
  commissionIds!: string[];

  @ApiPropertyOptional({ description: 'The transfer number of the money sent to the agent' })
  @IsOptional() @IsString() @MaxLength(120)
  reference?: string;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}
