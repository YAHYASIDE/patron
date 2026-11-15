import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsPositive, Matches, Max } from 'class-validator';

export class CurrencyParamDto {
  @ApiProperty({ example: 'MRU' })
  @Matches(/^[A-Za-z]{3}$/) currency!: string;
}

export class RecordRateDto {
  @ApiProperty({ example: 39.8, description: 'How much of the currency one unit of the base (USD) buys' })
  @IsNumber({ maxDecimalPlaces: 6 }) @IsPositive() @Max(1_000_000) rate!: number;

  @ApiPropertyOptional({ description: 'Apply a move of more than 15% (otherwise 409 BIG_CHANGE)' })
  @IsOptional() @IsBoolean() confirm?: boolean;
}
