import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';

/** Suppliers the owner can connect from the dashboard (each has an adapter). */
export const CONNECTABLE = ['gamesdrop'] as const;

export class ConnectProviderDto {
  @ApiProperty({ enum: CONNECTABLE }) @IsIn(CONNECTABLE) code!: (typeof CONNECTABLE)[number];

  /** The shop token from the supplier's dashboard. Stored encrypted, never returned. */
  @ApiProperty() @IsString() @Length(8, 512) apiKey!: string;

  @ApiPropertyOptional({ example: 'MR' })
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;

  /** Stop automatic purchases for the day once this much (supplier currency) was spent. */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) dailyLimit?: number;

  /** Warn the owner when the supplier balance falls under this. */
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) lowBalanceAlert?: number;
}

export class ProviderLimitsDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) dailyLimit?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1_000_000) lowBalanceAlert?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CatalogQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional({ example: 'Top Up' }) @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) page?: number;
}

export class LinkProductDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiProperty({ description: "The supplier's offer id (GamesDrop offerGroupId)" }) @IsString() @Length(1, 80) providerSku!: string;
  /** The most the shop pays the supplier per unit; purchases above it are refused. */
  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0.0001) @Max(100_000) providerCost!: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) priority?: number;
}

export class AutoDeliveryDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
}
