import { PrismaService } from '../../src/common/prisma/prisma.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';

export const noopMetrics = () =>
  ({
    providerCalls: { inc: jest.fn() },
    providerDuration: { startTimer: jest.fn(() => jest.fn()) },
    providerFailovers: { inc: jest.fn() },
    fulfilmentAttempts: { inc: jest.fn() },
    paymentsTotal: { inc: jest.fn() },
    orderValue: { inc: jest.fn() },
    webhooksTotal: { inc: jest.fn() },
    idempotencyReplays: { inc: jest.fn() },
    tokenReuseDetected: { inc: jest.fn() },
  }) as any;

/** Real span semantics without an exporter — spans are created and discarded. */
export const noopTracing = () =>
  ({
    withSpan: async (_n: string, _a: unknown, fn: (span: any) => Promise<unknown>) =>
      fn({ setAttribute: () => undefined, recordException: () => undefined, setStatus: () => undefined }),
    traceId: () => undefined,
    spanId: () => undefined,
    inject: (c: Record<string, string> = {}) => c,
    withRemoteContext: async (_c: unknown, fn: () => Promise<unknown>) => fn(),
    syncCorrelationId: () => undefined,
  }) as any;

const crypto = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);

export async function seedOrderItem(
  prisma: PrismaService,
  bases: { primaryBase: string; secondaryBase: string },
) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  await prisma.currency.upsert({
    where: { code: 'USD' }, update: {},
    create: { code: 'USD', nameAr: 'د', nameEn: 'USD', symbol: '$', isBase: true },
  });

  const category = await prisma.category.create({
    data: { slug: `cat-${stamp}`, nameAr: 'ف', nameEn: 'Cat' },
  });
  const product = await prisma.product.create({
    data: {
      sku: `SKU-${stamp}`, type: 'GIFT_CARD', delivery: 'AUTO_PROVIDER',
      nameAr: 'م', nameEn: 'Product', costPrice: 8, sellPrice: 10,
      currency: 'USD', categoryId: category.id,
    },
  });

  const primary = await prisma.provider.create({
    data: {
      code: 'fazercards', name: 'Primary', baseUrl: bases.primaryBase,
      apiKeyEnc: crypto.encrypt('primary-key'), apiSecretEnc: crypto.encrypt('primary-secret'),
      priority: 0, isHealthy: true, timeoutMs: 800,
    },
  });
  const secondary = await prisma.provider.create({
    data: {
      code: 'foxreload', name: 'Secondary', baseUrl: bases.secondaryBase,
      apiKeyEnc: crypto.encrypt('secondary-key'), apiSecretEnc: crypto.encrypt('secondary-secret'),
      priority: 1, isHealthy: true, timeoutMs: 800,
    },
  });

  await prisma.productProvider.createMany({
    data: [
      { productId: product.id, providerId: primary.id, providerSku: 'SKU_A', providerCost: 8, priority: 0 },
      { productId: product.id, providerId: secondary.id, providerSku: 'sku-a', providerCost: 8.2, priority: 1 },
    ],
  });

  const user = await prisma.user.create({
    data: { email: `res-${stamp}@test.local`, fullName: 'Resilience', passwordHash: 'x' },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: `PTN-${stamp}`, userId: user.id, status: 'PAID', paidAt: new Date(),
      subtotal: 10, total: 10, currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase: 10,
      items: {
        create: {
          productId: product.id, productNameAr: 'م', productNameEn: 'Product',
          quantity: 1, unitPrice: 10, unitCost: 8, lineTotal: 10, status: 'PENDING',
        },
      },
    },
    include: { items: true },
  });

  return {
    userId: user.id,
    orderId: order.id,
    orderItemId: order.items[0].id,
    productId: product.id,
    primaryId: primary.id,
    secondaryId: secondary.id,
  };
}
