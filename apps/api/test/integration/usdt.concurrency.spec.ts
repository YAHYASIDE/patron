import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { UsdtService } from '../../src/modules/usdt/usdt.service';
import { UsdtConfigService } from '../../src/modules/usdt/usdt-config.service';
import { tronAddressFromBytes } from '../../src/modules/usdt/usdt-address';
import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';

/**
 * USDT orders on a real Postgres: the row lock, the conditional status update
 * and the unique indexes (idempotency key, TXID) are what stop a double send.
 * Every address and TXID is generated here; nothing is ever transferred.
 */
describe('USDT orders (integration)', () => {
  let prisma: PrismaService;
  let config: UsdtConfigService;
  let usdt: UsdtService;
  let staff: StaffNotificationsService;
  let customerId: string;
  let ownerId: string;

  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const address = () => tronAddressFromBytes(randomBytes(20));
  const dto = () => ({ amountUsdt: '50', currency: 'MRU', delivery: 'ONCHAIN' as const, network: 'TRC20' as const, address: address() });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const audit = new AuditService(prisma);
    config = new UsdtConfigService(prisma, audit);
    staff = new StaffNotificationsService(prisma);
    usdt = new UsdtService(prisma, audit, config, staff);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.create({ data: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true } });
    await prisma.currency.create({ data: { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', decimals: 2 } });
    const tag = randomUUID();
    customerId = (await prisma.user.create({ data: { phone: `+2222${Math.floor(1e6 + Math.random() * 9e6)}`, fullName: 'Test Buyer', phoneVerifiedAt: new Date() } })).id;
    ownerId = (await prisma.user.create({ data: { email: `owner-${tag}@test.local`, fullName: 'Test Owner' } })).id;
    await prisma.systemSetting.create({
      data: {
        key: MANUAL_ACCOUNTS_KEY,
        value: [{ id: 'acc1', method: 'Bankily', accountNumber: '20000000', kind: 'mobile', enabled: true, countries: ['MR'] }],
      },
    });
  });

  const switchOn = () =>
    config.update(
      {
        enabled: true, legalApproval: true, rates: { MRU: '40.5' }, feePercent: '1.5', feeFixedUsdt: '0.25',
        minUsdt: '10', maxUsdt: '1000', networks: { TRC20: true, BEP20: true, ERC20: false }, binanceEnabled: true, expiryMinutes: 30,
      },
      ownerId,
    );

  /** An order that has been paid and is waiting for staff. */
  async function underReview() {
    const o = await usdt.create(customerId, randomUUID(), dto());
    await usdt.attachProof(customerId, o.id, { buffer: PNG, size: PNG.length });
    return usdt.submitPayment(customerId, o.id, { method: 'acc1', payerPhone: '22000000' });
  }

  it('answers USDT_DISABLED until the owner switches it on', async () => {
    await expect(usdt.quote(customerId, dto())).rejects.toMatchObject({ response: { error: 'USDT_DISABLED' } });
    await expect(usdt.create(customerId, randomUUID(), dto())).rejects.toMatchObject({ response: { error: 'USDT_DISABLED' } });
    expect(await config.publicSummary()).toEqual({ enabled: false });
  });

  it('freezes the totals: a later rate change does not touch an existing order', async () => {
    await switchOn();
    const o = await usdt.create(customerId, randomUUID(), dto());
    // 50 × 40.5 = 2025; fee 1.5% = 30.375 + 0.25 × 40.5 = 10.125 → 40.5
    expect(o).toMatchObject({ status: 'AWAITING_PAYMENT', rate: '40.5', subtotal: '2025', fee: '40.5', total: '2065.5' });
    await config.update({ ...(await config.get()), rates: { MRU: '45' } } as never, ownerId);
    expect((await usdt.forCustomer(o.id, customerId)).total).toBe('2065.5');
  });

  it('one Idempotency-Key makes one order, even when the requests race', async () => {
    await switchOn();
    const key = randomUUID();
    const body = dto();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => usdt.create(customerId, key, body)));
    const ids = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id));
    expect(ids.size).toBe(1);
    expect(await prisma.usdtOrder.count({ where: { userId: customerId } })).toBe(1);
    // and later, the same key still answers with that order
    expect((await usdt.create(customerId, key, body)).id).toBe([...ids][0]);
  });

  it('two staff approving at once: one wins, one event, one audit row', async () => {
    await switchOn();
    const o = await underReview();
    expect(o.status).toBe('UNDER_REVIEW');
    expect(await prisma.staffNotification.count({ where: { dedupeKey: `usdt.review:${o.id}`, resolvedAt: null } })).toBe(1);

    const results = await Promise.allSettled([usdt.approve(ownerId, o.id), usdt.approve(ownerId, o.id), usdt.approve(ownerId, o.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason.response.error).toBe('USDT_INVALID_STATUS');

    expect(await prisma.usdtOrderEvent.count({ where: { usdtOrderId: o.id, action: 'approved' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: o.id, action: 'usdt.approved' } })).toBe(1);
    expect(await prisma.staffNotification.count({ where: { dedupeKey: `usdt.review:${o.id}`, resolvedAt: null } })).toBe(0);
    expect(await prisma.staffNotification.count({ where: { dedupeKey: `usdt.send:${o.id}`, resolvedAt: null } })).toBe(1);
  });

  it('complete and reject racing on one order: exactly one lands', async () => {
    await switchOn();
    const o = await underReview();
    await usdt.approve(ownerId, o.id);
    const txid = randomBytes(32).toString('hex');
    const results = await Promise.allSettled([usdt.complete(ownerId, o.id, txid), usdt.reject(ownerId, o.id, 'Changed our mind')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const row = await prisma.usdtOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(['COMPLETED', 'REJECTED']).toContain(row.status);
    const finals = await prisma.usdtOrderEvent.count({ where: { usdtOrderId: o.id, action: { in: ['completed', 'rejected'] } } });
    expect(finals).toBe(1);
  });

  it('a TXID can be recorded on one order only, even at the same moment', async () => {
    await switchOn();
    const a = await underReview();
    const b = await underReview();
    await usdt.approve(ownerId, a.id);
    await usdt.approve(ownerId, b.id);
    const txid = randomBytes(32).toString('hex');
    const results = await Promise.allSettled([usdt.complete(ownerId, a.id, txid), usdt.complete(ownerId, b.id, txid.toUpperCase())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.response.error).toBe('USDT_TXID_DUPLICATE');
    expect(await prisma.usdtOrder.count({ where: { txid } })).toBe(1);
    expect(await prisma.staffNotification.count({ where: { type: 'usdt.send', resolvedAt: null } })).toBe(1);
  });

  it('the customer sees the timeline and the TXID once sent', async () => {
    await switchOn();
    const o = await underReview();
    await usdt.approve(ownerId, o.id);
    const txid = randomBytes(32).toString('hex');
    await usdt.complete(ownerId, o.id, txid);
    const seen = await usdt.forCustomer(o.id, customerId);
    expect(seen.status).toBe('COMPLETED');
    expect(seen.txid).toBe(txid);
    expect(seen.events.map((e) => e.action)).toEqual(['created', 'proof.attached', 'payment.submitted', 'approved', 'completed']);
    await expect(usdt.forCustomer(o.id, ownerId)).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
  });

  it('expires unpaid orders past their deadline, never paid ones', async () => {
    await switchOn();
    const unpaid = await usdt.create(customerId, randomUUID(), dto());
    const paid = await underReview();
    await prisma.usdtOrder.updateMany({ where: { id: { in: [unpaid.id, paid.id] } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await usdt.expireUnpaid()).toBe(1);
    expect((await prisma.usdtOrder.findUniqueOrThrow({ where: { id: unpaid.id } })).status).toBe('CANCELLED');
    expect((await prisma.usdtOrder.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe('UNDER_REVIEW');
    expect(await prisma.auditLog.count({ where: { entityId: unpaid.id, action: 'usdt.order.expire' } })).toBe(1);
  });
});
