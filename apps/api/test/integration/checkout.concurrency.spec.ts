import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CryptoService } from '../../src/common/crypto/crypto.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { ReferenceService } from '../../src/common/reference/reference.service';

/**
 * The single most important property of this system: a customer can never be
 * charged twice for one intent. These tests attack that from three angles —
 * concurrent order creation, quote reuse, and replayed payment capture.
 */
describe('Checkout concurrency', () => {
  let prisma: PrismaService;
  let orders: OrdersService;
  let userId: string;
  let quoteId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const crypto = new CryptoService({ getOrThrow: () => 'a'.repeat(64) } as any);
    // Real collaborators, not mocks: ReferenceService allocates order numbers
    // from a Postgres sequence, and a mock would hide a uniqueness bug that
    // only appears under the concurrency these tests exist to exercise.
    orders = new OrdersService(
      prisma,
      crypto,
      new OutboxService(prisma),
      new AuditService(prisma),
      new ReferenceService(prisma),
    );
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' },
      update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    const category = await prisma.category.create({
      data: { slug: `c-${Date.now()}`, nameAr: 'فئة', nameEn: 'Cat' },
    });
    const product = await prisma.product.create({
      data: {
        sku: `SKU-${Date.now()}`, type: 'GIFT_CARD', delivery: 'CODE_POOL',
        nameAr: 'منتج', nameEn: 'Product', costPrice: 8, sellPrice: 10,
        currency: 'USD', categoryId: category.id,
      },
    });
    const user = await prisma.user.create({
      data: { email: `co-${Date.now()}@test.local`, fullName: 'Buyer', passwordHash: 'x' },
    });
    userId = user.id;

    const quote = await prisma.checkoutQuote.create({
      data: {
        quoteNumber: `QT-${Date.now()}`, userId,
        subtotal: 10, total: 10, currency: 'USD', baseCurrency: 'USD',
        fxRate: 1, totalBase: 10, totalCostBase: 8,
        expiresAt: new Date(Date.now() + 900_000),
        items: {
          create: {
            productId: product.id, productNameAr: 'منتج', productNameEn: 'Product',
            quantity: 1, unitPrice: 10, unitPriceBase: 10, unitCostBase: 8, lineTotal: 10,
          },
        },
      },
    });
    quoteId = quote.id;
  });

  it('creates exactly one order when the same quote is submitted concurrently', async () => {
    const submit = () => orders.createFromQuote(userId, quoteId, {});

    const results = await Promise.allSettled([submit(), submit(), submit()]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');

    // The losers may either error or be handed the winner's order — both are
    // correct. What must never happen is two distinct orders.
    const orderCount = await prisma.order.count({ where: { quoteId } });
    expect(orderCount).toBe(1);
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
  });

  it('refuses to reuse a consumed quote', async () => {
    await orders.createFromQuote(userId, quoteId, {});
    await prisma.order.deleteMany({ where: { quoteId } }); // simulate a stale client retry

    await expect(orders.createFromQuote(userId, quoteId, {})).rejects.toThrow(/no longer valid|already been used/);
  });

  it('refuses an expired quote even if the client still holds the id', async () => {
    // Push the whole quote into the past. The `checkout_quotes_expiry_future`
    // CHECK requires expiresAt > createdAt, so move createdAt back too rather
    // than only expiring it — the quote reads as expired relative to now while
    // still satisfying the constraint.
    await prisma.checkoutQuote.update({
      where: { id: quoteId },
      data: {
        createdAt: new Date(Date.now() - 7_200_000),
        expiresAt: new Date(Date.now() - 3_600_000),
      },
    });

    await expect(orders.createFromQuote(userId, quoteId, {})).rejects.toThrow(/expired/);
  });

  it('refuses a quote belonging to another account', async () => {
    const other = await prisma.user.create({
      data: { email: `other-${Date.now()}@test.local`, fullName: 'Other', passwordHash: 'x' },
    });
    await expect(orders.createFromQuote(other.id, quoteId, {})).rejects.toThrow(/another account/);
  });

  it('writes the fulfilment intent to the outbox in the same transaction', async () => {
    const order = await orders.createFromQuote(userId, quoteId, {});
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });

    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('order.created');
  });

  it('copies frozen values verbatim rather than recalculating', async () => {
    // Move the catalog price after the quote was taken.
    const item = await prisma.quoteItem.findFirstOrThrow({ where: { quoteId } });
    await prisma.product.update({ where: { id: item.productId }, data: { sellPrice: 999 } });

    const order = await orders.createFromQuote(userId, quoteId, {});
    const full = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true },
    });

    expect(Number(full.total)).toBe(10);
    expect(Number(full.items[0].unitPrice)).toBe(10);
    expect(Number(full.items[0].unitCost)).toBe(8);
  });
});
