import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderAdapter, ProviderCredentials } from './adapters/provider-adapter.interface';
import { FazerCardsAdapter } from './adapters/fazercards.adapter';
import { FoxReloadAdapter } from './adapters/foxreload.adapter';

/**
 * Maps a provider row to its adapter implementation and decrypts credentials
 * on demand. Adding a provider means registering one class here and inserting
 * a row — nothing in the order pipeline changes.
 */
@Injectable()
export class ProviderRegistry implements OnModuleInit {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(
    private moduleRef: ModuleRef,
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  onModuleInit() {
    for (const type of [FazerCardsAdapter, FoxReloadAdapter]) {
      const adapter = this.moduleRef.get(type, { strict: false });
      this.adapters.set(adapter.code, adapter);
    }
  }

  getAdapter(code: string): ProviderAdapter {
    const adapter = this.adapters.get(code);
    if (!adapter) throw new NotFoundException(`No adapter registered for provider "${code}"`);
    return adapter;
  }

  listCodes(): string[] {
    return [...this.adapters.keys()];
  }

  async credentialsFor(providerId: string): Promise<{ adapter: ProviderAdapter; creds: ProviderCredentials; code: string }> {
    const provider = await this.prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
    return {
      code: provider.code,
      adapter: this.getAdapter(provider.code),
      creds: {
        baseUrl: provider.baseUrl,
        apiKey: this.crypto.decrypt(provider.apiKeyEnc),
        apiSecret: provider.apiSecretEnc ? this.crypto.decrypt(provider.apiSecretEnc) : undefined,
        config: (provider.extraConfig as Record<string, unknown>) ?? undefined,
        timeoutMs: provider.timeoutMs,
      },
    };
  }

  /**
   * Candidate providers for a product, best first. Unhealthy or inactive
   * providers are filtered out here rather than failing mid-fulfilment.
   */
  async candidatesFor(productId: string) {
    return this.prisma.productProvider.findMany({
      where: {
        productId,
        isActive: true,
        provider: { isActive: true, isHealthy: true },
      },
      include: { provider: true },
      orderBy: [{ priority: 'asc' }, { providerCost: 'asc' }],
    });
  }
}
