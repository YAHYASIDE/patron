import { IsEmail, IsIn, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,}$/;

export class RegisterDto {
  @IsEmail() email!: string;

  @IsString() @MinLength(10)
  @Matches(PASSWORD_RULE, { message: 'Password needs 10+ chars with upper, lower and a digit' })
  password!: string;

  @IsString() @Length(2, 80) fullName!: string;

  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{7,14}$/, { message: 'Phone must be E.164, e.g. +22212345678' })
  phone?: string;

  @IsOptional() @IsIn(['USD', 'EUR', 'MRU', 'XOF']) currency?: string;
  @IsOptional() @IsIn(['ar', 'en', 'fr']) locale?: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() deviceInfo?: string;
}

export class RefreshDto {
  @IsString() refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @Matches(PASSWORD_RULE, { message: 'Password needs 10+ chars with upper, lower and a digit' })
  newPassword!: string;
}

export class VerifyCodeDto {
  @IsString() @Length(6, 6) code!: string;
}

export class ForgotPasswordDto {
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @IsEmail() email!: string;
  @IsString() @Length(6, 6) code!: string;
  @IsString() @Matches(PASSWORD_RULE, { message: 'Password needs 10+ chars with upper, lower and a digit' })
  newPassword!: string;
}
