import { Module } from '@nestjs/common';
import { ProviderRegistry } from './provider-registry.service';
import { ProviderEngine } from './provider-engine.service';
import { ProvidersService } from './providers.service';
import { FazerCardsAdapter } from './adapters/fazercards.adapter';
import { FoxReloadAdapter } from './adapters/foxreload.adapter';
import { GamesDropAdapter } from './adapters/gamesdrop.adapter';
import { ProvidersController } from './providers.controller';
import { ProviderSetupService } from './provider-setup.service';

@Module({
  controllers: [ProvidersController],
  providers: [ProviderRegistry, ProviderEngine, ProvidersService, ProviderSetupService, FazerCardsAdapter, FoxReloadAdapter, GamesDropAdapter],
  exports: [ProviderEngine, ProviderRegistry, ProvidersService],
})
export class ProvidersModule {}
