import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { MarketsModule } from '../markets/markets.module';
import { ManualTransferGateway } from '../payments/gateways/manual.gateway';
import { IntelligenceController } from './intelligence.controller';
import { IntelligenceService } from './intelligence.service';
import { DiscoveriesStore } from './discoveries.store';
import { IntelIngestGuard } from './ingest.guard';
import { ScannersService } from './scanners/scanners.service';
import { CatalogReadinessScanner } from './scanners/catalog-readiness.scanner';
import { PaymentsByCountryScanner } from './scanners/payments-by-country.scanner';
import { MarketStalenessScanner } from './scanners/market-staleness.scanner';
import { ServerErrorsScanner } from './scanners/server-errors.scanner';
import { SearchGapsScanner } from './scanners/search-gaps.scanner';

/**
 * Discoveries, decisions, agent runs and the in-app scanners. Reads the shop
 * (catalog pricing, the owner's transfer accounts, stored errors and searches)
 * and never changes it. The daily scan job lives in QueuesModule.
 */
@Module({
  // PricingService decides whether a currency can be priced; ManualTransferGateway reads the accounts
  imports: [CatalogModule, MarketsModule],
  controllers: [IntelligenceController],
  providers: [
    IntelligenceService,
    DiscoveriesStore,
    IntelIngestGuard,
    ManualTransferGateway,
    ScannersService,
    CatalogReadinessScanner,
    PaymentsByCountryScanner,
    MarketStalenessScanner,
    ServerErrorsScanner,
    SearchGapsScanner,
  ],
  exports: [ScannersService, DiscoveriesStore],
})
export class IntelligenceModule {}
