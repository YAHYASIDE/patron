import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Test data builders. Every factory takes overrides so a test states only the
 * field it cares about — a test that spells out 15 irrelevant fields hides
 * which one is actually under test.
 */
export const factories = (prisma: PrismaClient) => ({
  currency(overrides: Partial<Prisma.CurrencyCreateInput> = {}) {
    return prisma.currency.upsert({
      where: { code: overrides.code ?? 'USD' },
      update: {},
      create: {
        code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$',
        decimals: 2, isBase: true, ...overrides,
      },
    });
  },

  user(overrides: Partial<Prisma.UserCreateInput> = {}) {
    return prisma.user.create({
      data: {
        email: `user-${Math.random().toString(36).slice(2)}@test.local`,
        fullName: 'Test User',
        passwordHash: '$2a$12$test',
        ...overrides,
      },
    });
  },

  product(categoryId: string, overrides: Partial<Prisma.ProductUncheckedCreateInput> = {}) {
    return prisma.product.create({
      data: {
        sku: `SKU-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        type: 'GIFT_CARD',
        delivery: 'CODE_POOL',
        nameAr: 'منتج', nameEn: 'Test Product',
        costPrice: 8, sellPrice: 10, currency: 'USD',
        categoryId,
        ...overrides,
      },
    });
  },
});
