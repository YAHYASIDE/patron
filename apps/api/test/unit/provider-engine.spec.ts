import { ProviderEngine } from '../../src/modules/providers/provider-engine.service';
import { FulfilOutcome } from '../../src/modules/providers/adapters/provider-adapter.interface';

const delivered = (ref = 'ext-1'): FulfilOutcome => ({
  status: 'DELIVERED', providerRef: ref, results: [{ resultType: 'code', value: 'ABC-123' }], raw: {},
});
const retryable = (): FulfilOutcome => ({
  status: 'FAILED', errorCode: 'temporary_failure', errorMessage: 'busy', retryable: true, raw: {},
});
const permanent = (): FulfilOutcome => ({
  status: 'FAILED', errorCode: 'invalid_player_id', errorMessage: 'no such player', retryable: false, raw: {},
});

describe('ProviderEngine', () => {
  let prisma: any;
  let registry: any;
  let crypto: any;
  let metrics: any;
  let tracing: any;
  let engine: ProviderEngine;
  let primary: any;
  let secondary: any;

  beforeEach(() => {
    primary = { code: 'fazercards', fulfil: jest.fn() };
    secondary = { code: 'foxreload', fulfil: jest.fn() };

    prisma = {
      orderItem: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 'item-1', productId: 'p1', quantity: 1, attemptCount: 1, inputs: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      providerCall: { create: jest.fn().mockResolvedValue({}) },
      provider: { update: jest.fn().mockResolvedValue({}) },
      productProvider: { findMany: jest.fn() },
      orderResult: { createMany: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (client: unknown) => unknown) => fn(prisma)),
    };

    registry = {
      candidatesFor: jest.fn().mockResolvedValue([
        { providerId: 'prov-1', providerSku: 'SKU_A', priority: 0 },
        { providerId: 'prov-2', providerSku: 'sku-a', priority: 1 },
      ]),
      credentialsFor: jest.fn((id: string) =>
        Promise.resolve(
          id === 'prov-1'
            ? { adapter: primary, creds: {}, code: 'fazercards' }
            : { adapter: secondary, creds: {}, code: 'foxreload' },
        ),
      ),
    };
    crypto = { sha256: () => 'k'.repeat(64), encrypt: (v: string) => `enc(${v})`, decrypt: (v: string) => v };
    metrics = {
      providerCalls: { inc: jest.fn() },
      providerDuration: { startTimer: jest.fn(() => jest.fn()) },
      providerFailovers: { inc: jest.fn() },
      fulfilmentAttempts: { inc: jest.fn() },
    };

    // TracingService is stubbed rather than real: the unit tier must not
    // depend on an OTel SDK being initialised.
    tracing = {
      withSpan: (_n: string, _a: unknown, fn: (span: any) => Promise<unknown>) =>
        fn({ setAttribute: jest.fn(), recordException: jest.fn(), setStatus: jest.fn() }),
      traceId: () => undefined,
    };

    engine = new ProviderEngine(prisma, registry, crypto, metrics, tracing);
  });

  it('delivers via the primary and never touches the secondary', async () => {
    primary.fulfil.mockResolvedValue(delivered());

    const result = await engine.fulfilItem('item-1');

    expect(result.status).toBe('DELIVERED');
    expect(secondary.fulfil).not.toHaveBeenCalled();
    expect(metrics.providerFailovers.inc).not.toHaveBeenCalled();
  });

  it('fails over to the secondary on a retryable error', async () => {
    primary.fulfil.mockResolvedValue(retryable());
    secondary.fulfil.mockResolvedValue(delivered('ext-2'));

    const result = await engine.fulfilItem('item-1');

    expect(result.status).toBe('DELIVERED');
    expect(result.providerId).toBe('prov-2');
    expect(metrics.providerFailovers.inc).toHaveBeenCalledWith({
      from_provider: 'fazercards', to_provider: 'foxreload',
    });
  });

  it('stops on a non-retryable error instead of paying a second provider', async () => {
    primary.fulfil.mockResolvedValue(permanent());

    const result = await engine.fulfilItem('item-1');

    expect(result.status).toBe('FAILED');
    // The critical assertion: a bad player ID must not trigger a second purchase.
    expect(secondary.fulfil).not.toHaveBeenCalled();
  });

  it('refuses to start when another worker already claimed the item', async () => {
    prisma.orderItem.updateMany.mockResolvedValue({ count: 0 });

    const result = await engine.fulfilItem('item-1');

    expect(result.status).toBe('PROCESSING');
    expect(primary.fulfil).not.toHaveBeenCalled();
  });

  it('sends a stable idempotency key so a retried call is not a second purchase', async () => {
    primary.fulfil.mockResolvedValue(delivered());
    await engine.fulfilItem('item-1');
    const firstKey = primary.fulfil.mock.calls[0][0].idempotencyKey;

    primary.fulfil.mockClear();
    await engine.fulfilItem('item-1');
    const secondKey = primary.fulfil.mock.calls[0][0].idempotencyKey;

    expect(firstKey).toBe(secondKey);
  });

  it('records every attempt, including failures', async () => {
    primary.fulfil.mockResolvedValue(retryable());
    secondary.fulfil.mockResolvedValue(retryable());

    await engine.fulfilItem('item-1');

    expect(prisma.providerCall.create).toHaveBeenCalledTimes(2);
  });

  it('treats an adapter that throws as a retryable failure, not a crash', async () => {
    primary.fulfil.mockRejectedValue(new Error('socket hang up'));
    secondary.fulfil.mockResolvedValue(delivered());

    const result = await engine.fulfilItem('item-1');
    expect(result.status).toBe('DELIVERED');
  });

  it('fails cleanly when no healthy provider is configured', async () => {
    registry.candidatesFor.mockResolvedValue([]);

    const result = await engine.fulfilItem('item-1');
    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/No healthy provider/);
  });

  it('encrypts delivered codes before they touch the database', async () => {
    primary.fulfil.mockResolvedValue(delivered());
    await engine.fulfilItem('item-1');

    const [{ data }] = prisma.orderResult.createMany.mock.calls[0];
    expect(data[0].valueEnc).toBe('enc(ABC-123)');
    expect(JSON.stringify(data)).not.toContain('"ABC-123"');
  });

  describe('owner limits', () => {
    it('passes the agreed cost to the adapter as the most it may pay', async () => {
      registry.candidatesFor.mockResolvedValue([{ providerId: 'prov-1', providerSku: 'SKU_A', providerCost: '0.9900', priority: 0 }]);
      primary.fulfil.mockResolvedValue(delivered());
      await engine.fulfilItem('item-1');
      expect(primary.fulfil.mock.calls[0][0]).toMatchObject({ providerSku: 'SKU_A', maxUnitCost: 0.99 });
      // recorded with the call, so today's spend never depends on a cost changed later
      expect(prisma.providerCall.create.mock.calls[0][0].data.requestBody).toMatchObject({ quantity: 1, maxUnitCost: 0.99 });
    });

    it('skips a supplier whose daily limit would be passed, and uses the next one', async () => {
      registry.candidatesFor.mockResolvedValue([
        { providerId: 'prov-1', providerSku: 'SKU_A', providerCost: '30', priority: 0 },
        { providerId: 'prov-2', providerSku: 'sku-a', providerCost: '31', priority: 1 },
      ]);
      registry.credentialsFor.mockImplementation((id: string) =>
        Promise.resolve(
          id === 'prov-1'
            ? { adapter: primary, creds: { config: { dailyLimit: 100 } }, code: 'gamesdrop' }
            : { adapter: secondary, creds: {}, code: 'foxreload' },
        ),
      );
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ spent: '80' }]); // 80 + 30 > 100
      secondary.fulfil.mockResolvedValue(delivered('fox-1'));

      const result = await engine.fulfilItem('item-1');

      expect(primary.fulfil).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: 'DELIVERED', providerId: 'prov-2' });
    });

    it('with no other supplier, the item fails for manual handling and nothing is bought', async () => {
      registry.candidatesFor.mockResolvedValue([{ providerId: 'prov-1', providerSku: 'SKU_A', providerCost: '30', priority: 0 }]);
      registry.credentialsFor.mockResolvedValue({ adapter: primary, creds: { config: { dailyLimit: 50 } }, code: 'gamesdrop' });
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ spent: '25' }]);

      const result = await engine.fulfilItem('item-1');

      expect(primary.fulfil).not.toHaveBeenCalled();
      expect(result.status).toBe('FAILED');
      expect(prisma.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: expect.stringContaining('daily_limit') }),
      }));
    });

    it('under the limit it buys as usual', async () => {
      registry.candidatesFor.mockResolvedValue([{ providerId: 'prov-1', providerSku: 'SKU_A', providerCost: '30', priority: 0 }]);
      registry.credentialsFor.mockResolvedValue({ adapter: primary, creds: { config: { dailyLimit: 100 } }, code: 'gamesdrop' });
      prisma.$queryRaw = jest.fn().mockResolvedValue([{ spent: '10' }]);
      primary.fulfil.mockResolvedValue(delivered());
      expect((await engine.fulfilItem('item-1')).status).toBe('DELIVERED');
    });
  });
});
