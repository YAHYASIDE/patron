import configuration from '../../src/config/configuration';

const KEYS = [
  'NODE_ENV', 'PORT', 'API_PREFIX', 'CORS_ORIGINS',
  'JWT_ACCESS_SECRET', 'JWT_ACCESS_TTL', 'JWT_REFRESH_SECRET', 'JWT_REFRESH_TTL',
  'ENCRYPTION_KEY', 'BASE_CURRENCY', 'FX_FEED_URL',
  'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'EMAIL_ENDPOINT', 'EMAIL_API_KEY', 'EMAIL_FROM', 'FCM_SERVER_KEY',
  'OTEL_ENABLED', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'OTEL_SAMPLE_RATIO', 'OTEL_SERVICE_NAME',
  'METRICS_TOKEN', 'LOG_LEVEL',
];

describe('configuration', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('applies defaults when nothing is set in the environment', () => {
    const c = configuration();

    expect(c.app).toEqual({ env: 'development', port: 3000, apiPrefix: 'api/v1', corsOrigins: undefined });
    expect(c.jwt.accessTtl).toBe('15m');
    expect(c.jwt.refreshTtl).toBe('30d');
    expect(c.currency.base).toBe('USD');
    expect(c.redis).toEqual({ host: 'localhost', port: 6379, password: undefined });
    expect(c.notifications.emailFrom).toBe('no-reply@patron.io');
    expect(c.otel.enabled).toBe(false);
    expect(c.otel.sampleRatio).toBe(0.1);
    expect(c.otel.serviceName).toBe('patron-api');
    expect(c.security).toEqual({ maxLoginAttempts: 5, lockoutMinutes: 15, otpTtlSeconds: 300 });
  });

  it('reads overrides and numeric-parses PORT and REDIS_PORT', () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '8080';
    process.env.REDIS_PORT = '6380';
    process.env.API_PREFIX = 'api/v2';
    process.env.BASE_CURRENCY = 'EUR';

    const c = configuration();

    expect(c.app.env).toBe('production');
    expect(c.app.port).toBe(8080);
    expect(c.app.apiPrefix).toBe('api/v2');
    expect(c.redis.port).toBe(6380);
    expect(c.currency.base).toBe('EUR');
  });

  it('treats OTEL_ENABLED as a strict "true" boolean flag', () => {
    process.env.OTEL_ENABLED = 'true';
    expect(configuration().otel.enabled).toBe(true);

    process.env.OTEL_ENABLED = 'True';
    expect(configuration().otel.enabled).toBe(false);

    process.env.OTEL_ENABLED = '1';
    expect(configuration().otel.enabled).toBe(false);
  });

  it('parses OTEL_SAMPLE_RATIO as a Number', () => {
    process.env.OTEL_SAMPLE_RATIO = '0.5';
    expect(configuration().otel.sampleRatio).toBe(0.5);
  });

  it('passes secret env values straight through', () => {
    process.env.JWT_ACCESS_SECRET = 'access-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.ENCRYPTION_KEY = 'enc-key';
    process.env.METRICS_TOKEN = 'metrics-token';
    process.env.STRIPE_SECRET_KEY = 'sk_test';

    const c = configuration();
    expect(c.jwt.accessSecret).toBe('access-secret');
    expect(c.jwt.refreshSecret).toBe('refresh-secret');
    expect(c.crypto.encryptionKey).toBe('enc-key');
    expect(c.observability.metricsToken).toBe('metrics-token');
    expect(c.payments.stripeSecretKey).toBe('sk_test');
  });
});
