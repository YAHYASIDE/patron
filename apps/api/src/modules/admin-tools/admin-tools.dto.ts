import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length,
  Matches, Max, MaxLength, Min, ValidateIf, ValidateNested,
} from 'class-validator';
import { CursorDto } from '../../common/dto/cursor.dto';

// ── Customers and orders (#37, #38) ──

export class UpdateCustomerDto {
  /** Staff-only note; null or empty clears it. */
  @IsOptional() @IsString() @MaxLength(1000)
  adminNote?: string | null;

  /** Short labels such as VIP or "watch". */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @Length(1, 20, { each: true })
  tags?: string[];
}

export class OrderNoteDto {
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000)
  note!: string | null;
}

// ── Data (#39) ──

export class ExportOrdersQueryDto {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

// ── Coupons (#41) ──

export class CreateCouponDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'code must be 3-40 letters, digits, - or _' })
  code!: string;

  @IsIn(['PERCENT', 'FIXED']) discountType!: 'PERCENT' | 'FIXED';

  /** Percent (1-100) for PERCENT, an amount in the base currency for FIXED. */
  @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(1_000_000) discountValue!: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) maxDiscount?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) minOrderTotal?: number | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) maxUsesPerUser?: number | null;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Same fields, all optional. Declared in full so `forbidNonWhitelisted` sees every key. */
export class UpdateCouponDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'code must be 3-40 letters, digits, - or _' })
  code?: string;
  @IsOptional() @IsIn(['PERCENT', 'FIXED']) discountType?: 'PERCENT' | 'FIXED';
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(1_000_000) discountValue?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) maxDiscount?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) minOrderTotal?: number | null;
  @IsOptional() @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @IsInt() @Min(1) maxUsesPerUser?: number | null;
  @IsOptional() @IsDateString() startsAt?: string | null;
  @IsOptional() @IsDateString() expiresAt?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

// ── WhatsApp quick replies (#44) ──

export class WhatsappTemplateDto {
  /** Kept when editing an existing reply; a new one gets an id from the server. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9-]{1,40}$/) id?: string;
  @IsString() @Length(1, 40) title!: string;
  /** May use {name}, {order} and {link}. */
  @IsString() @Length(1, 1000) body!: string;
}

export class WhatsappTemplatesDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => WhatsappTemplateDto)
  templates!: WhatsappTemplateDto[];
}

// ── Activity log (#46) ──

export class AuditQueryDto extends CursorDto {
  @IsOptional() @IsString() @Length(1, 60) entityType?: string;
  /** An exact action (catalog.product.update) or a prefix (catalog.). */
  @IsOptional() @IsString() @Length(1, 80) action?: string;
}

// ── Broadcast (#48) ──

export class BroadcastDto {
  @IsString() @Length(2, 80) titleAr!: string;
  @IsString() @Length(2, 500) bodyAr!: string;
  @IsOptional() @IsString() @Length(2, 80) titleFr?: string;
  @IsOptional() @IsString() @Length(2, 500) bodyFr?: string;
  @IsOptional() @IsString() @Length(2, 80) titleEn?: string;
  @IsOptional() @IsString() @Length(2, 500) bodyEn?: string;
  /** A store path ("/products?offers=1") or an https link. */
  @IsOptional() @IsString() @MaxLength(300) @Matches(/^(\/\S*|https:\/\/\S+)$/, { message: 'link must be a store path or an https link' })
  link?: string;
  /** Only customers in this country (ISO-3166 alpha-2). */
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166 alpha-2 code, e.g. MR' })
  country?: string;
}

// ── Catalogue tools (#34) ──

export class BulkPriceDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() gameId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) productIds?: string[];
  /** −50 … +100: −10 lowers every price by 10%. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-50) @Max(100) percent!: number;
  /** true: only show what would change. */
  @IsBoolean() dryRun!: boolean;
}
