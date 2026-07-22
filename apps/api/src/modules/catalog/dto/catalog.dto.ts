import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsEnum, IsInt, IsNumber, IsObject, IsOptional,
  IsString, IsUUID, Length, Matches, Min,
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

export class ProductPriceDto {
  @IsString() @Length(3, 3) currencyCode!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) sellPrice!: number;
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

  @IsOptional() @IsArray() @Type(() => ProductPriceDto) prices?: ProductPriceDto[];
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsInt() @Min(0) stockQty?: number;
  @IsOptional() @IsInt() @Min(1) maxPerOrder?: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
export class UpdateProductDto extends CreateProductDto {}

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
