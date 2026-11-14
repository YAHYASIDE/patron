import { Transform, Type } from 'class-transformer';
import {
  IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested,
} from 'class-validator';
import { UsdtDelivery, UsdtNetwork, UsdtOrderStatus } from '@prisma/client';

/** Money arrives as a string ("100.5"); a number is accepted and turned into one. */
const asString = ({ value }: { value: unknown }) => (typeof value === 'number' ? String(value) : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

const AMOUNT_RE = /^\d{1,9}(\.\d{1,2})?$/;
const DECIMAL_RE = /^\d{1,12}(\.\d{1,6})?$/;

export class UsdtQuoteDto {
  /** How many USDT the customer wants, at most 2 decimals. */
  @Transform(asString) @IsString() @Matches(AMOUNT_RE, { message: 'amountUsdt must be a number with at most 2 decimals' })
  amountUsdt!: string;

  @Transform(trim) @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;

  @IsEnum(UsdtDelivery) delivery!: UsdtDelivery;

  /** Required for ONCHAIN, ignored for BINANCE. */
  @IsOptional() @IsEnum(UsdtNetwork) network?: UsdtNetwork;
}

export class CreateUsdtOrderDto extends UsdtQuoteDto {
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) address?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) binanceId?: string;

  /** The total the customer saw; if the owner changed the rate since, the order is refused (USDT_QUOTE_CHANGED). */
  @IsOptional() @Transform(asString) @IsString() @Matches(DECIMAL_RE) expectedTotal?: string;
}

export class SubmitUsdtPaymentDto {
  /** The id of one of the owner's transfer accounts (GET /payments/manual-accounts). */
  @Transform(trim) @IsString() @Length(1, 64) method!: string;
  /** The number or account the customer paid from. */
  @Transform(trim) @IsString() @Length(4, 120) payerPhone!: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 100) reference?: string;
}

export class CompleteUsdtOrderDto {
  @Transform(trim) @IsString() @Length(6, 80) txid!: string;
}

export class RejectUsdtOrderDto {
  @Transform(trim) @IsString() @Length(3, 300) reason!: string;
}

export class UsdtOrdersQueryDto {
  @IsOptional() @IsEnum(UsdtOrderStatus) status?: UsdtOrderStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Order number, address, Binance id, TXID or customer phone. */
  @IsOptional() @Transform(trim) @IsString() @Length(1, 120) search?: string;
}

export class UsdtNetworksDto {
  @IsBoolean() TRC20!: boolean;
  @IsBoolean() BEP20!: boolean;
  @IsBoolean() ERC20!: boolean;
}

export class UsdtConfigDto {
  @IsBoolean() enabled!: boolean;
  /** Price of 1 USDT per paying currency: { "MRU": "41.5" }. Checked in the service. */
  @IsObject() rates!: Record<string, string>;
  @Transform(asString) @IsString() @Matches(DECIMAL_RE) feePercent!: string;
  @Transform(asString) @IsString() @Matches(DECIMAL_RE) feeFixedUsdt!: string;
  @Transform(asString) @IsString() @Matches(DECIMAL_RE) minUsdt!: string;
  @Transform(asString) @IsString() @Matches(DECIMAL_RE) maxUsdt!: string;
  @ValidateNested() @Type(() => UsdtNetworksDto) networks!: UsdtNetworksDto;
  @IsBoolean() binanceEnabled!: boolean;
  @Type(() => Number) @IsInt() @Min(5) @Max(1440) expiryMinutes!: number;
  /**
   * Switching the service on is the owner's legal decision: the dashboard sends
   * this only after they tick "I have the approval" (USDT_LEGAL_ACK_REQUIRED).
   */
  @IsOptional() @IsIn([true]) legalApproval?: true;
}
