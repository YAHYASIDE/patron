// Side effect first: BigInt values from raw report queries must serialise (see the file).
import './common/serialization/bigint-json';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { OutboxModule } from './common/outbox/outbox.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { AuditModule } from './common/audit/audit.module';
import { ReferenceModule } from './common/reference/reference.module';
import { MetricsModule } from './common/metrics/metrics.module';
import { TracingModule } from './common/tracing/tracing.module';
import { MetricsInterceptor } from './common/metrics/metrics.interceptor';
import { HealthModule } from './common/health/health.module';
import { CorrelationIdMiddleware } from './common/context/correlation-id.middleware';
import { loggerConfig } from './common/logging/logger.config';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ShopModule } from './modules/shop/shop.module';
import { BannersModule } from './modules/banners/banners.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { CustomerModule } from './modules/customer/customer.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { SupportModule } from './modules/support/support.module';
import { FeedbackModule } from './modules/feedback/feedback.module';
import { InsightsModule } from './modules/insights/insights.module';
import { AdminToolsModule } from './modules/admin-tools/admin-tools.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { FxModule } from './modules/fx/fx.module';
import { QueuesModule } from './modules/queues/queues.module';
import { ReportsModule } from './modules/reports/reports.module';
import { UsdtModule } from './modules/usdt/usdt.module';
import { AgentsModule } from './modules/agents/agents.module';
import { StaffNotificationsModule } from './modules/staff-notifications/staff-notifications.module';
import { BankNoticesModule } from './modules/bank-notices/bank-notices.module';
import { MarketsModule } from './modules/markets/markets.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { optInTier } from './common/guards/throttle-tiers';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    /**
     * Named tiers rather than one global limit. A customer browsing the catalog
     * legitimately makes far more requests than one creating orders, and a
     * single limit either throttles browsing or fails to constrain checkout.
     */
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'strict', ttl: 60_000, limit: 10, skipIf: optInTier('strict') },
      { name: 'expensive', ttl: 60_000, limit: 5, skipIf: optInTier('expensive') },
    ]),
    LoggerModule.forRoot(loggerConfig(process.env.NODE_ENV === 'production')),

    // infrastructure
    PrismaModule,
    CryptoModule,
    OutboxModule,
    IdempotencyModule,
    AuditModule,
    ReferenceModule,
    MetricsModule,
    TracingModule,
    HealthModule,

    // domain
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    CatalogModule,
    OrdersModule,
    WalletModule,
    RefundsModule,
    PaymentsModule,
    ShopModule,
    BannersModule,
    UploadsModule,
    CustomerModule,
    ReviewsModule,
    SupportModule,
    FeedbackModule,
    InsightsModule,
    AdminToolsModule,
    ProvidersModule,
    NotificationsModule,
    FxModule,
    ReportsModule,
    UsdtModule,
    AgentsModule,
    StaffNotificationsModule,
    BankNoticesModule,
    MarketsModule,
    IntelligenceModule,

    // async work
    QueuesModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    // Order matters: rate limit, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // First in the chain: everything downstream, including the logger, reads
    // the correlation id from the request context it establishes.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
