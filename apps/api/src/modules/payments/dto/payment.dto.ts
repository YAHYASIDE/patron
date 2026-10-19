import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested,
} from 'class-validator';
import { PaymentGateway } from '@prisma/client';

export class InitiatePaymentDto {
  @IsUUID() orderId!: string;
  @IsEnum(PaymentGateway) gateway!: PaymentGateway;
  @IsOptional() @IsString() returnUrl?: string;
}

export class RequestRefundDto {
  @IsUUID() orderId!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) amount?: number;
  @IsString() @Length(3, 500) reason!: string;
  @IsOptional() toWallet?: boolean;
}

export class AdjustWalletDto {
  @IsUUID() userId!: string;
  @IsString() @Length(3, 3) currency!: string;
  @IsNumber({ maxDecimalPlaces: 4 }) amount!: number;
  @IsString() @Length(3, 500) reason!: string;
}

// ── Manual transfer ──

export class SubmitTransferDto {
  /** Which of the owner's accounts the customer paid into (from GET /payments/manual-accounts). */
  @IsString() @Length(1, 64) accountId!: string;
  /** The number (or Binance ID / wallet) the money was sent from: the owner looks it up in their app. */
  @IsString() @Length(4, 120) payerPhone!: string;
  /** Optional now that a receipt is required; kept for apps that show one. */
  @IsOptional() @IsString() @Length(0, 100) reference?: string;
  @IsOptional() @IsString() @Length(2, 80) payerName?: string;
}

export class RejectPaymentDto {
  @IsString() @Length(3, 300) reason!: string;
}

export class ManualAccountDto {
  @IsOptional() @IsString() @Length(1, 64) id?: string;
  @IsString() @Length(2, 40) method!: string;
  /** Older clients send one country. */
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  /** ISO country codes; "XX" = every other country; empty = everywhere. */
  @IsOptional() @IsArray() @ArrayMaxSize(60) @Matches(/^[A-Za-z]{2}$/, { each: true }) countries?: string[];
  @IsOptional() @IsString() @Length(0, 80) accountName?: string;
  /** Required while the method is switched on (checked in the service). */
  @IsOptional() @IsString() @Length(0, 120) accountNumber?: string;
  @IsOptional() @IsIn(['mobile', 'bank', 'crypto']) kind?: 'mobile' | 'bank' | 'crypto';
  /** A built-in logo key or "upload:<uuid>". */
  @IsOptional() @IsString() @Matches(/^([a-z0-9-]{1,40}|upload:[0-9a-f-]{36})$/) logo?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @Length(0, 300) instructions?: string;
}

export class ManualAccountsDto {
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ManualAccountDto)
  accounts!: ManualAccountDto[];
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
