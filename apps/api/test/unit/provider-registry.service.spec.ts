import { NotFoundException } from '@nestjs/common';
import { ProviderRegistry } from '../../src/modules/providers/provider-registry.service';

describe('ProviderRegistry', () => {
  let moduleRef: any;
  let prisma: any;
  let crypto: any;
  let registry: ProviderRegistry;
  let fazer: any;
  let fox: any;

  beforeEach(() => {
    fazer = { code: 'fazercards' };
    fox = { code: 'foxreload' };
    // onModuleInit resolves adapters in the order [FazerCards, FoxReload].
    moduleRef = { get: jest.fn().mockReturnValueOnce(fazer).mockReturnValueOnce(fox) };
    prisma = {
      provider: { findUniqueOrThrow: jest.fn() },
      productProvider: { findMany: jest.fn().mockResolvedValue([]) },
    };
    crypto = { decrypt: jest.fn((v: string) => `dec(${v})`) };
    registry = new ProviderRegistry(moduleRef, prisma, crypto);
    registry.onModuleInit();
  });

  describe('onModuleInit / getAdapter / listCodes', () => {
    it('registers both adapters keyed by their code', () => {
      expect(registry.getAdapter('fazercards')).toBe(fazer);
      expect(registry.getAdapter('foxreload')).toBe(fox);
      expect(registry.listCodes().sort()).toEqual(['fazercards', 'foxreload']);
    });

    it('throws NotFound for an unknown provider code', () => {
      expect(() => registry.getAdapter('mystery')).toThrow(NotFoundException);
    });
  });

  describe('credentialsFor', () => {
    it('decrypts key and secret and shapes the credentials object', async () => {
      prisma.provider.findUniqueOrThrow.mockResolvedValue({
        code: 'fazercards',
        baseUrl: 'https://api.fazer',
        apiKeyEnc: 'KEY',
        apiSecretEnc: 'SECRET',
        extraConfig: { region: 'eu' },
        timeoutMs: 8000,
      });

      const res = await registry.credentialsFor('p1');

      expect(res.code).toBe('fazercards');
      expect(res.adapter).toBe(fazer);
      expect(res.creds).toEqual({
        baseUrl: 'https://api.fazer',
        apiKey: 'dec(KEY)',
        apiSecret: 'dec(SECRET)',
        config: { region: 'eu' },
        timeoutMs: 8000,
      });
    });

    it('omits the secret when the provider has none, and defaults config to undefined', async () => {
      prisma.provider.findUniqueOrThrow.mockResolvedValue({
        code: 'foxreload',
        baseUrl: 'https://api.fox',
        apiKeyEnc: 'KEY',
        apiSecretEnc: null,
        extraConfig: null,
        timeoutMs: 5000,
      });

      const res = await registry.credentialsFor('p2');

      expect(res.creds.apiSecret).toBeUndefined();
      expect(res.creds.config).toBeUndefined();
      expect(crypto.decrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe('candidatesFor', () => {
    it('filters to active+healthy providers, best (priority then cost) first', () => {
      registry.candidatesFor('prod-1');
      const arg = prisma.productProvider.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        productId: 'prod-1',
        isActive: true,
        provider: { isActive: true, isHealthy: true },
      });
      expect(arg.orderBy).toEqual([{ priority: 'asc' }, { providerCost: 'asc' }]);
    });
  });
});
