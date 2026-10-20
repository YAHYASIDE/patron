import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ProviderRegistry } from './provider-registry.service';

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private prisma: PrismaService,
    private registry: ProviderRegistry,
    private crypto: CryptoService,
  ) {}

  /** Credentials are never returned, in any form, to any role. */
  findAll() {
    return this.prisma.provider.findMany({
      orderBy: { priority: 'asc' },
      select: {
        id: true, code: true, name: true, baseUrl: true, isActive: true, priority: true,
        balance: true, isHealthy: true, lastHealthCheckAt: true, timeoutMs: true, maxRetries: true,
        _count: { select: { products: true } },
      },
    });
  }

  async rotateKey(id: string, apiKey: string, apiSecret: string | undefined, actorId: string) {
    await this.prisma.provider.update({
      where: { id },
      data: {
        apiKeyEnc: this.crypto.encrypt(apiKey),
        apiSecretEnc: apiSecret ? this.crypto.encrypt(apiSecret) : undefined,
      },
    });
    await this.prisma.auditLog.create({
      data: { userId: actorId, action: 'providers.rotate_key', entityType: 'Provider', entityId: id },
    });
    return { message: 'Credentials rotated' };
  }

  /** Probe every provider; drives isHealthy, which gates the failover list. */
  async runHealthChecks() {
    const providers = await this.prisma.provider.findMany({ where: { isActive: true } });
    const results: Array<{ code: string; healthy: boolean }> = [];

    for (const provider of providers) {
      let healthy = false;
      try {
        const { adapter, creds } = await this.registry.credentialsFor(provider.id);
        healthy = await adapter.healthCheck(creds);

        if (healthy) {
          const balance = await adapter.getBalance(creds).catch(() => null);
          if (balance) {
            await this.prisma.provider.update({
              where: { id: provider.id },
              data: { balance: balance.balance },
            });
            if (provider.lowBalanceAlert && balance.balance < Number(provider.lowBalanceAlert)) {
              this.logger.warn(`Provider ${provider.code} balance is low: ${balance.balance}`);
            }
          }
        }
      } catch (err) {
        this.logger.error(`Health check failed for ${provider.code}: ${(err as Error).message}`);
      }

      await this.prisma.provider.update({
        where: { id: provider.id },
        data: { isHealthy: healthy, lastHealthCheckAt: new Date() },
      });
      results.push({ code: provider.code, healthy });
    }
    return results;
  }
}
