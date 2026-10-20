export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: process.env.CORS_ORIGINS,
    // Proxies in front of the API (Render's load balancer = 1). Lets req.ip be
    // the customer, not the proxy, so rate limits are per customer.
    trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET!,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET!,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  crypto: { encryptionKey: process.env.ENCRYPTION_KEY! },
  currency: {
    base: process.env.BASE_CURRENCY ?? 'USD',
    feedUrl: process.env.FX_FEED_URL,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  payments: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  notifications: {
    emailEndpoint: process.env.EMAIL_ENDPOINT,
    emailApiKey: process.env.EMAIL_API_KEY,
    emailFrom: process.env.EMAIL_FROM ?? 'no-reply@patron.io',
    fcmServerKey: process.env.FCM_SERVER_KEY,
  },
  otel: {
    enabled: process.env.OTEL_ENABLED === 'true',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    sampleRatio: Number(process.env.OTEL_SAMPLE_RATIO ?? 0.1),
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'patron-api',
  },
  observability: {
    metricsToken: process.env.METRICS_TOKEN,
    logLevel: process.env.LOG_LEVEL,
  },
  security: {
    maxLoginAttempts: 5,
    lockoutMinutes: 15,
    otpTtlSeconds: 300,
    // codes the owner sends by hand over WhatsApp need time to reach the customer
    relayedOtpTtlSeconds: 1800,
  },
});
