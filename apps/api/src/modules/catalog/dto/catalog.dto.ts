import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsObject, IsOptional,
  IsPositive, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { DeliveryMode, ProductType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ── Categories ──

export class CreateCategoryDto {
  @IsString() @Matches(SLUG, { message: 'slug must be kebab-case' }) slug!: string;
  @IsString() @Length(2, 80) nameAr!: string;
  @IsString() @Length(2, 80) nameEn!: string;
  @IsOptional() @IsString() iconUrl?: string;
  @IsOptional() @IsString() bannerUrl?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateCategoryDto extends CreateCategoryDto {}

// ── Games ──

export class GameInputFieldDto {
  @IsString() key!: string;
  @IsString() labelAr!: string;
  @IsString() labelEn!: string;
  @IsString() type!: string;
  @IsBoolean() required!: boolean;
  @IsOptional() @IsString() regex?: string;
  @IsOptional() @IsBoolean() sensitive?: boolean;
}

export class CreateGameDto {
  @IsString() @Matches(SLUG) slug!: string;
  @IsString() @Length(2, 80) nameAr!: string;
  @IsString() @Length(2, 80) nameEn!: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() publisher?: string;
  @IsOptional() @IsArray() @Type(() => GameInputFieldDto) inputSchema?: GameInputFieldDto[];
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateGameDto extends CreateGameDto {}

// ── Products ──

/** A fixed price in one currency, used instead of converting sellPrice. 0 would give the product away. */
export class ProductPriceDto {
  @IsString() @Length(3, 3) currencyCode!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() sellPrice!: number;
}

export class CreateProductDto {
  @IsString() @Length(3, 40) sku!: string;
  @IsEnum(ProductType) type!: ProductType;
  @IsEnum(DeliveryMode) delivery!: DeliveryMode;
  @IsString() @Length(2, 120) nameAr!: string;
  @IsString() @Length(2, 120) nameEn!: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() gameId?: string;

  /** Always expressed in the platform base currency. */
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) costPrice!: number;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) sellPrice!: number;

  /**
   * Fixed prices per currency. On update the list replaces them all: a currency
   * left out goes back to automatic (converted from sellPrice), [] clears every one.
   * Validated item by item; without it a stray field reached Prisma as a 500.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ProductPriceDto)
  prices?: ProductPriceDto[];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) stockQty?: number;
  @IsOptional() @IsInt() @Min(1) maxPerOrder?: number;
  /** The owner's own discount (whole percent), applied to every currency. null clears it. */
  @IsOptional() @IsInt() @Min(0) @Max(90) discountPercent?: number | null;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
/**
 * A product edit sends only what changed (the dashboard's quick edit toggles
 * one field); the service checks the result against the saved product.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {}

// ── Queries ──

export class QueryCatalogDto extends PaginationDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() gameId?: string;
  @IsOptional() @IsEnum(ProductType) type?: ProductType;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Boolean) @IsBoolean() isFeatured?: boolean;

  /** Currency the customer is shopping in; defaults to the base currency. */
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
}

export class AddCodesDto {
  /** One code per entry (the dashboard splits a pasted list by line). */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000)
  @IsString({ each: true }) @Length(1, 500, { each: true })
  codes!: string[];

  @IsOptional() @IsString() @Length(0, 60) batchRef?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}
