import { plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, ValidateIf, validateSync } from 'class-validator';

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

  /**
   * Required in production: the /metrics endpoint fails closed without it, so
   * a missing token must stop the app booting rather than silently disable the
   * guard. Optional elsewhere so local/test scraping stays frictionless.
   */
  @ValidateIf((o) => o.NODE_ENV === Env.production)
  @IsString() @Length(16) METRICS_TOKEN?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const parsed = plainToInstance(EnvVars, config, { enableImplicitConversion: true });
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(`Invalid environment:\n${errors.map((e) => `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('\n')}`);
  }
  return parsed;
}
