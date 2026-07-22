import 'reflect-metadata';
import { validateEnv } from '../../src/config/env.validation';

const valid = () => ({
  NODE_ENV: 'development',
  PORT: '3000',
  DATABASE_URL: 'postgres://localhost/patron',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  ENCRYPTION_KEY: 'c'.repeat(64),
});

describe('validateEnv', () => {
  it('accepts a valid config and coerces PORT to a number', () => {
    const parsed = validateEnv(valid());
    expect(parsed.PORT).toBe(3000);
    expect(typeof parsed.PORT).toBe('number');
    expect(parsed.NODE_ENV).toBe('development');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...valid(), NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects a missing DATABASE_URL', () => {
    const cfg: any = valid();
    delete cfg.DATABASE_URL;
    expect(() => validateEnv(cfg)).toThrow(/DATABASE_URL/);
  });

  it('rejects a JWT access secret shorter than 32 chars', () => {
    expect(() => validateEnv({ ...valid(), JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects an ENCRYPTION_KEY that is not exactly 64 chars', () => {
    expect(() => validateEnv({ ...valid(), ENCRYPTION_KEY: 'c'.repeat(63) })).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects a BASE_CURRENCY that is not 3 chars, but allows a valid one', () => {
    expect(() => validateEnv({ ...valid(), BASE_CURRENCY: 'US' })).toThrow(/BASE_CURRENCY/);
    expect(validateEnv({ ...valid(), BASE_CURRENCY: 'EUR' }).BASE_CURRENCY).toBe('EUR');
  });

  it('allows PORT to be omitted (optional)', () => {
    const cfg: any = valid();
    delete cfg.PORT;
    expect(() => validateEnv(cfg)).not.toThrow();
  });

  describe('production METRICS_TOKEN gate', () => {
    it('requires a METRICS_TOKEN in production', () => {
      expect(() => validateEnv({ ...valid(), NODE_ENV: 'production' })).toThrow(/METRICS_TOKEN/);
    });

    it('accepts production when a long-enough METRICS_TOKEN is present', () => {
      const parsed = validateEnv({ ...valid(), NODE_ENV: 'production', METRICS_TOKEN: 'm'.repeat(16) });
      expect(parsed.NODE_ENV).toBe('production');
    });

    it('rejects a too-short METRICS_TOKEN in production', () => {
      expect(() =>
        validateEnv({ ...valid(), NODE_ENV: 'production', METRICS_TOKEN: 'short' }),
      ).toThrow(/METRICS_TOKEN/);
    });

    it('ignores METRICS_TOKEN outside production', () => {
      // No token, development -> the ValidateIf gate is skipped entirely.
      expect(() => validateEnv(valid())).not.toThrow();
    });
  });
});
