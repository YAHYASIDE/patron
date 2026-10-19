import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min,
  ValidateNested,
} from 'class-validator';
import { OrderStatus, Prisma } from '@prisma/client';
import { CursorDto } from '../../../common/dto/cursor.dto';

export class QuoteItemInputDto {
  @IsString() @Length(1, 60) key!: string;
  @IsString() @Length(1, 200) value!: string;
}

export class CreateQuoteItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(1) @Max(100) quantity = 1;

  /** Values for the game's inputSchema fields (Player ID, server, ...). */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => QuoteItemInputDto)
  inputs?: QuoteItemInputDto[];
}

export class CreateQuoteDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20)
  @ValidateNested({ each: true }) @Type(() => CreateQuoteItemDto)
  items!: CreateQuoteItemDto[];

  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @Length(3, 40) couponCode?: string;
}

export class CreateOrderDto {
  @IsUUID() quoteId!: string;
}

export class QueryOrdersDto extends CursorDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsString() @Length(1, 60) search?: string;

  // Staff filters (GET /admin/orders); the customer's own list ignores them.
  /** Orders with a payment through this gateway. */
  @IsOptional() @IsIn(['MANUAL', 'WALLET', 'STRIPE']) gateway?: 'MANUAL' | 'WALLET' | 'STRIPE';
  /** The customer's country (ISO-3166 alpha-2). */
  @IsOptional() @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166 alpha-2 code, e.g. MR' }) country?: string;
  /** Created at or after. A bare date (2026-10-19) means the start of that day. */
  @IsOptional() @IsDateString() from?: string;
  /** Created at or before. A bare date includes that whole day. */
  @IsOptional() @IsDateString() to?: string;
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `createdAt` filter from optional ISO `from`/`to`. A bare `to` date covers
 * that whole day, so from=to=2026-10-19 is one day rather than a zero-width range.
 */
export function createdAtRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = new Date(from);
  if (to) {
    if (BARE_DATE.test(to)) range.lt = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000);
    else range.lte = new Date(to);
  }
  return range;
}

export class RetryItemDto {
  @IsOptional() @IsUUID() providerId?: string; // force a specific provider
}

/** Staff deliver a MANUAL item by hand: one value per code/voucher (or one message). */
export class ManualFulfilDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsString({ each: true }) @Length(1, 2000, { each: true })
  values!: string[];
  @IsOptional() @IsIn(['code', 'serial', 'message']) resultType?: 'code' | 'serial' | 'message';
}
