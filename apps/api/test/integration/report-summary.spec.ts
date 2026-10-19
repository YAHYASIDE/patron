import { plainToInstance } from 'class-transformer';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { ReportSummaryService } from '../../src/modules/reports/summary.service';
import { ReportSummaryQueryDto } from '../../src/modules/reports/dto/summary.dto';

/**
 * The audit found the profit report counting a partial refund as profit, a
 * failed line as a sale, the wallet as cash received, and refunds as losses a
 * second time. These run the report's real SQL on real orders.
 */
describe('Profit report on real orders', () => {
  let prisma: PrismaService;
  let reports: ReportSummaryService;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    reports = new ReportSummaryService(prisma);
  });

  afterAll(() => prisma.$disconnect());

  async function shop() {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    const user = await prisma.user.create({ data: { phone: `+2224${Date.now() % 1e7}`, fullName: 'Aicha' } });
    const category = await prisma.category.create({ data: { slug: `c-${Date.now()}`, nameAr: 'ف', nameEn: 'C' } });
    const product = await prisma.product.create({
      data: { sku: `P-${Date.now()}`, type: 'GIFT_CARD', delivery: 'MANUAL', nameAr: 'بطاقة', nameEn: 'Card', costPrice: 8, sellPrice: 10, currency: 'USD', categoryId: category.id },
    });
    let n = 0;
    const order = async (lines: Array<'DELIVERED' | 'FAILED'>, gateway: 'MANUAL' | 'WALLET', status = 'COMPLETED') => {
      const o = await prisma.order.create({
        data: {
          orderNumber: `PTN-R-${Date.now()}-${n++}`, userId: user.id, status: status as never, paidAt: now,
          subtotal: 10 * lines.length, total: 10 * lines.length, currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase: 10 * lines.length,
          items: {
            create: lines.map((s) => ({
              productId: product.id, productNameAr: 'بطاقة', productNameEn: 'Card', unitPrice: 10, unitCost: 8, lineTotal: 10, status: s,
              ...(s === 'DELIVERED' && { deliveredAt: now }),
            })),
          },
        },
      });
      const p = await prisma.payment.create({
        data: {
          orderId: o.id, userId: user.id, gateway, amount: o.total, currency: 'USD', baseCurrency: 'USD', fxRate: 1, amountBase: o.total,
          status: 'CAPTURED', capturedAt: now, gatewayRef: `ref-${o.id}`,
          rawResponse: gateway === 'MANUAL' ? { transfer: { method: 'Bankily' } } : {},
        },
      });
      return { o, p };
    };
    return { user, order };
  }

  it('takes partial refunds and failed lines off the sales, and keeps the wallet out of cash', async () => {
    const { user, order } = await shop();
    // a clean transfer sale: 10 sold, 8 cost
    await order(['DELIVERED'], 'MANUAL');
    // a transfer sale of 20 with 4 refunded later
    const partly = await order(['DELIVERED', 'DELIVERED'], 'MANUAL');
    await prisma.refund.create({
      data: {
        orderId: partly.o.id, paymentId: partly.p.id, amount: 4, currency: 'USD', fxRate: 1, amountBase: 4, reason: 'late',
        status: 'PROCESSED', processedAt: now, requestedById: user.id, processedById: user.id,
      },
    });
    // a wallet sale of 20 where one line failed and is not refunded yet
    await order(['DELIVERED', 'FAILED'], 'WALLET', 'PARTIALLY_COMPLETED');

    const r = await reports.summary(plainToInstance(ReportSummaryQueryDto, { from: today, to: today }), now);

    // 10 + (20 − 4) + (20 − 10 owed) = 36; cost 8 + 16 + 8 = 32
    expect(r.totals.revenue).toBe('36.00');
    expect(r.totals.cost).toBe('32.00');
    expect(r.totals.profit).toBe('4.00');
    // the 4 refunded is shown, not counted again as a loss; the 10 owed is owed, not lost
    expect(r.losses.refunds).toBe('4.00');
    expect(r.losses.owed).toEqual({ count: 1, value: '10.00' });
    expect(r.losses.total).toBe('0.00');
    // cash that came in today: the transfers only; the wallet sale is shown apart
    expect(r.today.cashByMethod).toEqual([expect.objectContaining({ method: 'Bankily', amount: '26.00', orders: 2 })]);
    expect(r.today.walletUsed).toEqual({ amount: '10.00', orders: 1 });
    expect(r.topCustomers[0]).toEqual(expect.objectContaining({ spent: '36.00', profit: '4.00' }));
  });
});
