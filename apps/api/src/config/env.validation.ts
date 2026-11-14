import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf, validateSync } from 'class-validator';

enum Env { development = 'development', test = 'test', production = 'production' }

class EnvVars {
  @IsEnum(Env) NODE_ENV!: Env;
  @IsOptional() @IsInt() PORT?: number;

  @IsString() DATABASE_URL!: string;

  @IsString() @Length(32) JWT_ACCESS_SECRET!: string;
  @IsString() @Length(32) JWT_REFRESH_SECRET!: string;

  // 32 raw bytes as hex
  @IsString() @Length(64, 64) ENCRYPTION_KEY!: string;

  @IsOptional() @IsString() @Length(3, 3) BASE_CURRENCY?: string;

  /** Reverse proxies in front of the API; 0 (default) trusts none. */
  @IsOptional() @IsInt() @Min(0) @Max(5) TRUST_PROXY_HOPS?: number;

  /**
   * Required in production: the /metrics endpoint fails closed without it, so
   * a missing token must stop the app booting rather than silently disable the
   * guard. Optional elsewhere so local/test scraping stays frictionless.
   */
  @ValidateIf((o) => o.NODE_ENV === Env.production)
  @IsString() @Length(16) METRICS_TOKEN?: string;

  /**
   * Who delivers phone codes. Choosing Twilio without its three settings must
   * stop the boot: otherwise every sign-in code would fail at the first customer.
   */
  @ValidateIf((o) => !!o.OTP_PROVIDER) @IsIn(['owner_relay', 'twilio_verify', 'capture']) OTP_PROVIDER?: string;
  @ValidateIf((o) => o.OTP_PROVIDER === 'twilio_verify')
  @IsString() @Matches(/^AC[0-9a-zA-Z]{8,}$/, { message: 'TWILIO_ACCOUNT_SID must start with AC' })
  TWILIO_ACCOUNT_SID?: string;
  @ValidateIf((o) => o.OTP_PROVIDER === 'twilio_verify')
  @IsString() @Length(16) TWILIO_AUTH_TOKEN?: string;
  @ValidateIf((o) => o.OTP_PROVIDER === 'twilio_verify')
  @IsString() @Matches(/^VA[0-9a-zA-Z]{8,}$/, { message: 'TWILIO_VERIFY_SERVICE_SID must start with VA' })
  TWILIO_VERIFY_SERVICE_SID?: string;
  @ValidateIf((o) => !!o.TWILIO_VERIFY_CHANNEL) @IsIn(['sms', 'whatsapp']) TWILIO_VERIFY_CHANNEL?: string;

  /** Email codes: Resend when a key is set (or EMAIL_PROVIDER=resend), else off. */
  @ValidateIf((o) => !!o.EMAIL_PROVIDER) @IsIn(['resend', 'capture', 'disabled']) EMAIL_PROVIDER?: string;
  @ValidateIf((o) => o.EMAIL_PROVIDER === 'resend')
  @IsString() @Length(8) RESEND_API_KEY?: string;
  @ValidateIf((o) => o.EMAIL_PROVIDER === 'resend' || (!o.EMAIL_PROVIDER && !!o.RESEND_API_KEY))
  @IsString() @Matches(/@/, { message: 'EMAIL_FROM must be an address, e.g. patron <no-reply@your-domain>' })
  EMAIL_FROM?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const parsed = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(`Invalid environment:\n${errors.map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('\n')}`);
  }
  return parsed;
}
