import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Length, Matches, MinLength, ValidateIf,
} from 'class-validator';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;
const PASSWORD_MSG = 'Password needs 10+ chars with upper, lower and a digit';
const CODE_RULE = /^\d{6}$/;
const CODE_MSG = 'The code is 6 digits';

export class RegisterDto {
  @ApiProperty({ example: 'customer@example.com' })
  @IsEmail() email!: string;

  @ApiProperty({ example: 'Str0ngPass!', minLength: 10, description: PASSWORD_MSG })
  @IsString() @MinLength(10) @Length(10, 128)
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

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;
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
  @IsString() @Matches(CODE_RULE, { message: CODE_MSG }) code!: string;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;
}

export class RequestPhoneCodeDto {
  @ApiPropertyOptional({ example: '+22222123456', description: 'Only for an account that has no number yet' })
  @IsOptional() @IsString() @Matches(E164, { message: E164_MSG }) phone?: string;
}

export class LoginDto {
  @ApiPropertyOptional({ example: 'customer@example.com', description: 'Older clients: the email. Prefer `identifier`.' })
  @ValidateIf((o) => o.identifier === undefined)
  @IsEmail() email?: string;

  @ApiPropertyOptional({ example: '+22222123456', description: 'An email or an E.164 phone number' })
  @IsOptional() @IsString() @Length(3, 254) identifier?: string;

  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString() @Length(1, 128) password!: string;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari', description: 'Free-text device label for the session list' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The opaque refresh token returned at login' })
  @IsString() refreshToken!: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'Str0ngPass!' })
  @IsString() @Length(1, 128) currentPassword!: string;

  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Length(10, 128) @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}

/** First password for an account that signs in by WhatsApp number (verified first). */
export class SetPasswordDto {
  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Length(10, 128) @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}

export class VerifyCodeDto {
  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString() @Matches(CODE_RULE, { message: CODE_MSG }) code!: string;
}

export class ForgotPasswordDto {
  @ApiPropertyOptional({ example: 'customer@example.com', description: 'Older clients: the email. Prefer `identifier`.' })
  @ValidateIf((o) => o.identifier === undefined)
  @IsEmail() email?: string;

  @ApiPropertyOptional({ example: '+22222123456', description: 'An email or an E.164 phone number' })
  @IsOptional() @IsString() @Length(3, 254) identifier?: string;
}

export class ResetPasswordDto {
  @ApiPropertyOptional({ example: 'customer@example.com', description: 'Older clients: the email. Prefer `identifier`.' })
  @ValidateIf((o) => o.identifier === undefined)
  @IsEmail() email?: string;

  @ApiPropertyOptional({ example: '+22222123456', description: 'The email or number the code was sent to' })
  @IsOptional() @IsString() @Length(3, 254) identifier?: string;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString() @Matches(CODE_RULE, { message: CODE_MSG }) code!: string;

  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Length(10, 128) @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}

// ─────────────── Support-assisted recovery ───────────────

export class RecoveryRequestDto {
  @ApiProperty({ example: '+22222123456', description: 'The number or email the lost account used' })
  @IsString() @Length(3, 254) contact!: string;

  @ApiProperty({ example: 'سيدي أحمد' })
  @IsString() @Length(2, 80) fullName!: string;

  @ApiProperty({ example: 'Last order PTN-20261001-000123, 500 MRU, PUBG UC', description: 'What proves the account is yours' })
  @IsString() @Length(10, 1000) proof!: string;

  @ApiPropertyOptional({ example: '+22233123456', description: 'Where the reset code should go if the old contact is lost' })
  @IsOptional() @IsString() @Length(3, 254) newContact?: string;
}

export class RecoveryCompleteDto {
  @ApiProperty({ example: '+22233123456', description: 'The number or email the recovery code was sent to' })
  @IsString() @Length(3, 254) contact!: string;

  @ApiProperty({ example: '123456' })
  @IsString() @Matches(CODE_RULE, { message: CODE_MSG }) code!: string;

  @ApiProperty({ example: 'N3wStr0ngPass!', description: PASSWORD_MSG })
  @IsString() @Length(10, 128) @Matches(PASSWORD_RULE, { message: PASSWORD_MSG })
  newPassword!: string;
}

export class RecoveryReviewDto {
  @ApiPropertyOptional({ example: 'Matched the last two orders', description: 'Staff note (never a code or a password)' })
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class RecoveryListQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'VERIFIED', 'REJECTED', 'COMPLETED'] })
  @IsOptional() @IsIn(['PENDING', 'VERIFIED', 'REJECTED', 'COMPLETED']) status?: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'COMPLETED';
}

// ─────────────── Passkeys (WebAuthn) ───────────────

export class PasskeyRegisterVerifyDto {
  @ApiProperty() @IsUUID() challengeId!: string;

  @ApiProperty({ description: 'The browser\'s RegistrationResponseJSON' })
  @IsObject() response!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'iPhone 15' })
  @IsOptional() @IsString() @Length(0, 60) deviceName?: string;
}

export class PasskeyLoginVerifyDto {
  @ApiProperty() @IsUUID() challengeId!: string;

  @ApiProperty({ description: 'The browser\'s AuthenticationResponseJSON' })
  @IsObject() response!: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'iPhone 15 · Safari' })
  @IsOptional() @IsString() @Length(0, 120) deviceInfo?: string;
}
