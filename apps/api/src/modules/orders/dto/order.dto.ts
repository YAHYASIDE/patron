import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested,
} from 'class-validator';
import { OrderStatus } from '@prisma/client';
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
