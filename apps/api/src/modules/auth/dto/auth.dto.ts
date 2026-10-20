import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;
const PASSWORD_MSG = 'Password needs 10+ chars with upper, lower and a digit';

export class RegisterDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail() email!: string;

  @ApiProperty({ example: 'Str0ngPass!', minLength: 10, description: PASSWORD_MSG })
  @IsString() @MinLength(10)
  @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  password!: string;

  @ApiProperty({ example: 'Amina Sy', minLength: 2, maxLength: 80 })
  @IsString() @Length(2, 80) fullName!: string;

  @ApiPropertyOptional({ example: '+22212345678', description: 'E.164 format' })
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be E.164, e.g. +22212345678' })
  phone?: string;

  @ApiPropertyOptional({ enum: ['USD', 'EUR', 'MRU', 'XOF'] })
  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) currency?: string;

  @ApiPropertyOptional({ enum: ['ar', 'en', 'fr'] })
  @IsOptional() @IsIn(['ar', 'en', 'fr']) locale?: string;

  @ApiPropertyOptional({ example: 'K7MXQ2', description: 'Referral code from a ?ref= link; kept only for a new account' })
  @IsOptional() @IsString() @Length(0, 24) ref?: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const E164_MSG = 'Phone must be E.164, e.g. +22212345678';
// Arabic or Latin letters (accents included), spaces and the usual name punctuation
const FULL_NAME = /^[\p{Script=Arabic}\p{Script=Latin}][\p{Script=Arabic}\p{Script=Latin}\p{M}\s'’.-]{1,79}$/u;
const FULL_NAME_MSG = 'Full name must be written in Arabic or French letters';

export class PhoneStartDto {
  @ApiProperty({ example: '+22222123456', description: 'WhatsApp number, E.164' })
  @IsString() @Matches(E164, { message: E164_MSG }) phone!: string;

  @ApiPropertyOptional({ example: 'سيدي أحمد', description: 'Required for a new number; ignored for an existing account' })
  @IsOptional() @IsString() @Length(2, 80) @Matches(FULL_NAME, { message: FULL_NAME_MSG }) fullName?: string;

  @ApiPropertyOptional({ enum: ['ar', 'fr', 'en'] })
  @IsOptional() @IsIn(['ar', 'fr', 'en']) locale?: string;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;

  @ApiPropertyOptional({ example: 'K7MXQ2', description: 'Referral code from a ?ref= link; kept only for a new account' })
  @IsOptional() @IsString() @Length(0, 24) ref?: string;
}

export class PhoneLoginDto {
  @ApiProperty({ example: '+22222123456' })
  @IsString() @Matches(E164, { message: E164_MSG }) phone!: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString() @Matches(/^\d{6}$/, { message: 'The code is 6 digits' }) code!: string;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;
}

export class RequestPhoneCodeDto {
  @ApiPropertyOptional({ example: '+22222123456', description: 'Only for an account that has no number yet' })
  @IsOptional() @IsString() @Matches(E164, { message: E164_MSG }) phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail() email!: string;

  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString() password!: string;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari', description: 'Free-text device label for the session list' })
  @IsOptional() @IsString() deviceInfo?: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The opaque refresh token returned at login' })
  @IsString() refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString() currentPassword!: string;

  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString() @Length(6, 6) code!: string;
}

export class ForgotPasswordDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail() email!: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString() @Length(6, 6) code!: string;

  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}
