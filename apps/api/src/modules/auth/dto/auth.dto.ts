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
