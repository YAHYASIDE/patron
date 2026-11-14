import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { ALLOWED_APPS_KEY, BankNoticesService } from '../../src/modules/bank-notices/bank-notices.service';

const APP = 'mr.bankily.app';

/**
 * Bank notices on a real Postgres: the unique fingerprint is what keeps a
 * notification the phone sends twice (at the same moment) to one row, and the
 * confirm step must never move the payment it points at.
 */
describe('Bank notices (Postgres)', () => {
  let prisma: PrismaService;
  let staff: StaffNotificationsService;
  let service: BankNoticesService;
  let adminId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    staff = new StaffNotificationsService(prisma);
    service = new BankNoticesService(prisma, new AuditService(prisma), staff);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    await prisma.currency.upsert({
      where: { code: 'MRU' }, update: {},
      create: { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', decimals: 0 },
    });
    await prisma.systemSetting.create({ data: { key: ALLOWED_APPS_KEY, value: [APP], group: 'payments' } });
    adminId = (await prisma.user.create({ data: { email: `bank-${randomUUID()}@test.local`, fullName: 'Owner', passwordHash: 'x' } })).id;
  });

  async function manualPayment(amount: number, reported: { reference?: string; payerPhone?: string } | null) {
    const user = await prisma.user.create({ data: { email: `payer-${randomUUID()}@test.local`, fullName: 'Payer', passwordHash: 'x' } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `PTN-B-${randomUUID().slice(0, 8)}`, userId: user.id, status: 'PENDING_PAYMENT',
        subtotal: amount, total: amount, currency: 'MRU', baseCurrency: 'USD', fxRate: 40, totalBase: amount / 40,
      },
    });
    return prisma.payment.create({
      data: {
        orderId: order.id, userId: user.id, gateway: 'MANUAL', amount, currency: 'MRU', baseCurrency: 'USD', fxRate: 40,
        amountBase: amount / 40, status: reported ? 'AUTHORIZED' : 'INITIATED',
        rawResponse: reported ? { transfer: { ...reported, method: 'Bankily', hasProof: true } } : undefined,
      },
    });
  }

  const body = (text: string, postedAt = '2026-10-20T10:00:00.000Z') => ({ deviceId: 'phone-1', sourceApp: APP, text, postedAt });

  it('the same notification sent four times at once is stored once', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.ingest(body('Vous avez reçu 700 MRU de 22334455. Réf: TX-1001'), adminId)),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await prisma.bankNotification.count()).toBe(1);
    // one staff notice for it, however many times it arrived
    expect(await prisma.staffNotification.count({ where: { type: 'bank.unmatched' } })).toBe(1);
  });

  it('never stores a one-time code', async () => {
    await service.ingest(body('Code OTP: 99887 — vous avez reçu 300 MRU'), adminId);
    const row = await prisma.bankNotification.findFirstOrThrow();
    expect(row.text).not.toContain('99887');
  });

  it('a second notice with a known reference is a duplicate of the first, both kept', async () => {
    const a = await service.ingest(body('Vous avez reçu 700 MRU. Réf: TX-2002', '2026-10-20T10:00:00.000Z'), adminId);
    const b = await service.ingest(body('Virement reçu 700 MRU, référence TX-2002', '2026-10-20T10:01:00.000Z'), adminId);
    expect(b).toMatchObject({ status: 'DUPLICATE', duplicate: false });
    expect((await prisma.bankNotification.findUniqueOrThrow({ where: { id: b.id } })).duplicateOfId).toBe(a.id);
    expect(await prisma.bankNotification.count()).toBe(2);
  });

  it('suggests the waiting payment, and confirming records the link without approving anything', async () => {
    const other = await manualPayment(1500, null);
    const payment = await manualPayment(1500, { reference: '88213451', payerPhone: '22334455' });
    await manualPayment(900, { reference: '88213451' });

    const res = await service.ingest(body('تم استلام 1500 أوقية من 22334455. رقم العملية: 88213451'), adminId);
    expect(res).toMatchObject({ status: 'SUGGESTED', amount: '1500', currency: 'MRU', reference: '88213451' });
    const row = await prisma.bankNotification.findUniqueOrThrow({ where: { id: res.id } });
    expect(row.suggestedPaymentId).toBe(payment.id);
    expect(await prisma.staffNotification.findUnique({ where: { dedupeKey: `bank.match:${res.id}` } })).toMatchObject({ resolvedAt: null });

    const confirmed = await service.confirm(res.id, payment.id, adminId);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', matchedPaymentId: payment.id, reviewedById: adminId });
    // evidence only: the payment and its order are exactly as they were
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { order: true } });
    expect(after.status).toBe('AUTHORIZED');
    expect(after.order.status).toBe('PENDING_PAYMENT');
    expect(await prisma.staffNotification.findUnique({ where: { dedupeKey: `bank.match:${res.id}` } })).toMatchObject({ resolvedAt: expect.any(Date) });
    expect(await prisma.auditLog.count({ where: { action: 'bank_notices.confirm', entityId: res.id } })).toBe(1);

    // a second notice cannot be linked to the same payment
    const second = await service.ingest(body('تم استلام 1500 أوقية', '2026-10-20T11:00:00.000Z'), adminId);
    await expect(service.confirm(second.id, payment.id, adminId)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'BANK_NOTICE_PAYMENT_TAKEN' }),
    });
    expect(other.status).toBe('INITIATED');
  });

  it('two people confirming two notices for one payment at once: one wins', async () => {
    const payment = await manualPayment(400, { reference: 'R-1' });
    const a = await service.ingest(body('reçu 400 MRU', '2026-10-20T10:00:00.000Z'), adminId);
    const b = await service.ingest(body('reçu 400 MRU de nouveau', '2026-10-20T10:05:00.000Z'), adminId);
    const results = await Promise.allSettled([service.confirm(a.id, payment.id, adminId), service.confirm(b.id, payment.id, adminId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.bankNotification.count({ where: { matchedPaymentId: payment.id, status: 'CONFIRMED' } })).toBe(1);
  });

  it('refuses an app the owner did not allow', async () => {
    await expect(service.ingest({ ...body('reçu 100 MRU'), sourceApp: 'com.example.chat' }, adminId)).rejects.toMatchObject({
      response: expect.objectContaining({ error: 'BANK_APP_NOT_ALLOWED' }),
    });
    expect(await prisma.bankNotification.count()).toBe(0);
  });
});
