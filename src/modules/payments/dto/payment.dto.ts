import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';
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
