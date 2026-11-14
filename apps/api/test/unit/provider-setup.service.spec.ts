import { randomUUID } from 'crypto';
import { ProviderSetupService } from '../../src/modules/providers/provider-setup.service';

describe('ProviderSetupService', () => {
  let prisma: any;
  let registry: any;
  let crypto: any;
  let engine: any;
  let adapter: any;
  let service: ProviderSetupService;
  const token = `shop-${randomUUID()}`;

  beforeEach(() => {
    adapter = {
      code: 'gamesdrop',
      getBalance: jest.fn().mockResolvedValue({ balance: 50, currency: 'USD' }),
      searchCatalog: jest.fn().mockResolvedValue({
        total: 2,
        offers: [
          { sku: '101', productName: 'PUBG Mobile', offerName: '60 UC', price: 0.99, currency: 'USD', inStock: true, needsPlayerId: true, needsServer: false },
          { sku: '102', productName: 'PUBG Mobile', offerName: '325 UC', price: 4.9, currency: 'USD', inStock: true, needsPlayerId: true, needsServer: false },
        ],
      }),
      testOrder: jest.fn(),
    };
    const provider = { id: 'prov-1', code: 'gamesdrop', name: 'GamesDrop', isActive: true, extraConfig: { countryCode: 'MR' }, lowBalanceAlert: null, _count: { products: 0 } };
    prisma = {
      provider: {
        findUnique: jest.fn().mockResolvedValue(provider),
        create: jest.fn().mockResolvedValue(provider),
        update: jest.fn().mockResolvedValue(provider),
      },
      product: { findUnique: jest.fn().mockResolvedValue({ id: 'p1' }), update: jest.fn() },
      productProvider: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'link-1' }),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        delete: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    registry = {
      getAdapter: jest.fn().mockReturnValue(adapter),
      credentialsFor: jest.fn().mockResolvedValue({ adapter, creds: { apiKey: token }, code: 'gamesdrop' }),
    };
    crypto = { encrypt: jest.fn((v: string) => `enc(${v.length})`) };
    engine = { spentToday: jest.fn().mockResolvedValue(12.5) };
    service = new ProviderSetupService(prisma, registry, crypto, engine);
  });

  it('connect stores the token encrypted and never returns it', async () => {
    prisma.provider.findUnique.mockResolvedValueOnce(null);
    const res = await service.connect({ code: 'gamesdrop', apiKey: ` ${token} `, countryCode: 'MR', dailyLimit: 100 }, 'owner');

    expect(crypto.encrypt).toHaveBeenCalledWith(token);
    expect(prisma.provider.create.mock.calls[0][0].data).toMatchObject({
      code: 'gamesdrop', baseUrl: 'https://partner.gamesdrop.io', apiKeyEnc: `enc(${token.length})`,
      extraConfig: { countryCode: 'MR', dailyLimit: 100 },
    });
    expect(JSON.stringify(res)).not.toContain(token);
    expect(res).toMatchObject({ connected: true, balance: { balance: 50, currency: 'USD' }, spentToday: 12.5 });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'providers.connect' }) });
  });

  it('a token GamesDrop refuses shows as not connected', async () => {
    adapter.getBalance.mockRejectedValue(new Error('401'));
    const res = await service.status('prov-1');
    expect(res).toMatchObject({ connected: false, balance: null });
    expect(prisma.provider.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isHealthy: false }) }));
  });

  it('catalog search marks offers already linked to a product', async () => {
    prisma.productProvider.findMany.mockResolvedValueOnce([{ providerSku: '102', productId: 'p9' }]);
    const res = await service.catalog('prov-1', { search: 'PUBG' });
    expect(adapter.searchCatalog).toHaveBeenCalledWith({ apiKey: token }, { search: 'PUBG' });
    expect(res.offers.map((o) => o.linkedProductId)).toEqual([null, 'p9']);
  });

  it('a new link starts with automatic delivery OFF', async () => {
    await service.link('prov-1', { productId: 'p1', providerSku: '101', providerCost: 0.99 }, 'owner');
    expect(prisma.productProvider.upsert.mock.calls[0][0].create).toMatchObject({ isActive: false, providerCost: 0.99 });
    expect(prisma.product.update).not.toHaveBeenCalled();
  });

  it('auto delivery on switches the product to the supplier; off puts it back to manual', async () => {
    prisma.productProvider.findUnique.mockResolvedValue({ id: 'link-1', productId: 'p1', provider: { isActive: true } });
    prisma.productProvider.count.mockResolvedValueOnce(1);
    await service.setAuto('link-1', true, 'owner');
    expect(prisma.productProvider.update).toHaveBeenCalledWith({ where: { id: 'link-1' }, data: { isActive: true } });
    expect(prisma.product.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: { delivery: 'AUTO_PROVIDER' } });

    prisma.productProvider.count.mockResolvedValueOnce(0);
    await service.setAuto('link-1', false, 'owner');
    expect(prisma.product.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: { delivery: 'MANUAL' } });
  });

  it('auto delivery cannot be switched on while the supplier is off', async () => {
    prisma.productProvider.findUnique.mockResolvedValue({ id: 'link-1', productId: 'p1', provider: { isActive: false } });
    await expect(service.setAuto('link-1', true, 'owner')).rejects.toMatchObject({ response: { error: 'PROVIDER_INACTIVE' } });
  });

  it('margin is computed only when the shop and supplier currencies match', async () => {
    prisma.productProvider.findMany.mockResolvedValue([
      { id: 'a', productId: 'p1', providerSku: '101', providerCost: '0.99', isActive: true, product: { nameAr: 'أ', sku: 'A', sellPrice: '1.50', currency: 'USD', delivery: 'AUTO_PROVIDER' }, provider: { extraConfig: { currency: 'USD' } } },
      { id: 'b', productId: 'p2', providerSku: '102', providerCost: '4.90', isActive: false, product: { nameAr: 'ب', sku: 'B', sellPrice: '200', currency: 'MRU', delivery: 'MANUAL' }, provider: { extraConfig: { currency: 'USD' } } },
    ]);
    const [a, b] = await service.links('prov-1');
    expect(a).toMatchObject({ margin: 0.51, autoDelivery: true });
    expect(b).toMatchObject({ margin: null, autoDelivery: false });
  });

  it('the test order reports the outcome without echoing any code', async () => {
    adapter.testOrder.mockResolvedValue({ status: 'DELIVERED', providerRef: '42', results: [{ resultType: 'code', value: 'TEST_KEY_X' }], raw: {} });
    const res = await service.testOrder('prov-1', 'owner');
    expect(res).toEqual({ ok: true, status: 'DELIVERED', providerRef: '42' });
    adapter.testOrder.mockResolvedValue({ status: 'FAILED', errorCode: 'invalid_token', errorMessage: 'bad token', retryable: false, raw: {} });
    expect(await service.testOrder('prov-1', 'owner')).toMatchObject({ ok: false, error: 'invalid_token' });
  });
});
