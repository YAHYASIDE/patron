import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Min, ValidateNested,
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
  @IsString() @Length(3, 100) reference!: string;
  @IsOptional() @IsString() @Length(2, 80) payerName?: string;
  @IsOptional() @IsString() @Length(6, 20) payerPhone?: string;
}

export class RejectPaymentDto {
  @IsString() @Length(3, 300) reason!: string;
}

export class ManualAccountDto {
  @IsOptional() @IsString() @Length(1, 64) id?: string;
  @IsString() @Length(2, 40) method!: string;
  @IsOptional() @IsString() @Length(2, 2) country?: string;
  @IsString() @Length(2, 80) accountName!: string;
  @IsString() @Length(2, 60) accountNumber!: string;
  @IsOptional() @IsString() @Length(0, 300) instructions?: string;
}

export class ManualAccountsDto {
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ManualAccountDto)
  accounts!: ManualAccountDto[];
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
