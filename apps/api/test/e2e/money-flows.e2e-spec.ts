import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { hash } from '@node-rs/argon2';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * The money paths the October audit found broken, through HTTP as the store
 * and the dashboard call them: a wallet paid three times at once, the owner's
 * note leaking to the customer, a transfer refund marked done before any money
 * moved, and refunds that stopped after a partial one.
 */
describe('Money flows (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customer: string;
  let customerId: string;
  let owner: string;
  let productId: string;
  const PLAYER = { key: 'player_id', value: '5123456789' };

  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
    'hex',
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    productId = await seed(prisma);

    const phone = `+2224${String(Date.now()).slice(-7)}`;
    const res = await http().post('/auth/phone/start').send({ phone, fullName: 'زبونة المال' }).expect(200);
    customer = res.body.accessToken;
    customerId = (await prisma.user.update({ where: { phone }, data: { phoneVerifiedAt: new Date() } })).id;

    const email = `owner-${Date.now()}@shop.test`;
    // a fresh password each run: nothing that reads like a credential lives in the repo
    const password = randomUUID();
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
    await prisma.user.create({
      data: { email, fullName: 'المالك', passwordHash: await hash(password), roles: { create: { roleId: role.id } } },
    });
    owner = (await http().post('/auth/login').send({ email, password }).expect(200)).body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (path: string) => http().get(path).set('authorization', `Bearer ${token}`),
    post: (path: string, body?: object) => http().post(path).set('authorization', `Bearer ${token}`).send(body ?? {}),
  });

  async function newOrder(): Promise<{ id: string; total: string }> {
    const q = await as(customer).post('/checkout/quotes', { items: [{ productId, quantity: 1, inputs: [PLAYER] }], currency: 'MRU' }).expect(201);
    const o = await http().post('/checkout/orders').set('authorization', `Bearer ${customer}`)
      .set('Idempotency-Key', randomUUID()).send({ quoteId: q.body.id }).expect(201);
    return o.body;
  }

  it('charges a wallet once when three payments for one order arrive together', async () => {
    await prisma.wallet.upsert({
      where: { userId_currencyCode: { userId: customerId, currencyCode: 'MRU' } },
      update: {},
      create: { userId: customerId, currencyCode: 'MRU' },
    });
    await as(owner).post('/wallet/adjust', { userId: customerId, currency: 'MRU', amount: 100, reason: 'رصيد الاختبار' }).expect(200);
    const order = await newOrder();

    const pay = () => http().post('/payments').set('authorization', `Bearer ${customer}`)
      .set('Idempotency-Key', randomUUID()).send({ orderId: order.id, gateway: 'WALLET' });
    const results = await Promise.all([pay(), pay(), pay()]);

    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400]);
    const wallet = await prisma.wallet.findFirstOrThrow({ where: { userId: customerId, currencyCode: 'MRU' } });
    expect(Number(wallet.balance)).toBe(60);
    expect(await prisma.payment.count({ where: { orderId: order.id, status: 'CAPTURED' } })).toBe(1);
  });

  it("keeps the owner's note and costs out of what the customer reads", async () => {
    const order = await newOrder();
    await http().patch(`/admin/orders/${order.id}/note`).set('authorization', `Bearer ${owner}`)
      .send({ note: 'ملاحظة داخلية: تحقّق من الدافع' }).expect(200);

    const mine = await as(customer).get(`/orders/${order.id}`).expect(200);
    const list = await as(customer).get('/orders').expect(200);
    for (const body of [JSON.stringify(mine.body), JSON.stringify(list.body)]) {
      expect(body).not.toContain('ملاحظة داخلية');
      expect(body).not.toContain('adminNote');
      expect(body).not.toContain('unitCost');
      expect(body).not.toContain('ipAddress');
    }
    // the owner still sees it
    const staff = await as(owner).get(`/admin/orders/${order.id}`).expect(200);
    expect(staff.body.adminNote).toBe('ملاحظة داخلية: تحقّق من الدافع');
  });

  it('refunds a transfer in parts: by hand only with the transfer number, then the rest to the wallet', async () => {
    const order = await newOrder();
    const pay = await http().post('/payments').set('authorization', `Bearer ${customer}`)
      .set('Idempotency-Key', randomUUID()).send({ orderId: order.id, gateway: 'MANUAL' }).expect(201);
    const paymentId: string = pay.body.paymentId;
    const accounts = (await http().get('/payments/manual-accounts').expect(200)).body;
    const account = (accounts.accounts ?? accounts)[0];
    await http().post(`/payments/${paymentId}/proof`).set('authorization', `Bearer ${customer}`)
      .attach('file', PNG, { filename: 'r.png', contentType: 'image/png' }).expect(200);
    await as(customer).post(`/payments/${paymentId}/transfer`, { accountId: account.id, payerPhone: '22123456' }).expect(200);
    await as(owner).post(`/admin/payments/${paymentId}/approve`).expect(200);

    // 10 back by transfer: not done until the owner gives the number of the transfer they sent
    const part = await as(owner).post('/admin/refunds', { orderId: order.id, amount: 10, reason: 'تأخّر التسليم', toWallet: false }).expect(201);
    const early = await as(owner).post(`/admin/refunds/${part.body.id}/process`).expect(400);
    expect(early.body.error).toBe('REFUND_REFERENCE_REQUIRED');
    const done = await as(owner).post(`/admin/refunds/${part.body.id}/process`, { reference: 'BK-7781' }).expect(200);
    expect(done.body).toMatchObject({ status: 'PROCESSED', gatewayRef: 'manual:BK-7781' });

    // what is left can still be refunded, and asking for more is refused
    const staff = await as(owner).get(`/admin/orders/${order.id}`).expect(200);
    expect(Number(staff.body.refundable)).toBe(30);
    await as(owner).post('/admin/refunds', { orderId: order.id, amount: 31, reason: 'أكثر من الباقي', toWallet: true }).expect(400);

    const rest = await as(owner).post('/admin/refunds', { orderId: order.id, reason: 'الباقي إلى المحفظة', toWallet: true }).expect(201);
    expect(Number(rest.body.amount)).toBe(30);
    await as(owner).post(`/admin/refunds/${rest.body.id}/process`).expect(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe('REFUNDED');
    expect(Number(payment.refundedAmount)).toBe(40);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('REFUNDED');
    const credit = await prisma.walletTransaction.findFirstOrThrow({ where: { userId: customerId, type: 'REFUND', referenceId: rest.body.id } });
    expect(Number(credit.amount)).toBe(30);
  });

  it('answers an expired price with a code the store can act on', async () => {
    const q = await as(customer).post('/checkout/quotes', { items: [{ productId, quantity: 1, inputs: [PLAYER] }], currency: 'MRU' }).expect(201);
    // as if the customer had waited 20 minutes on the payment page
    await prisma.checkoutQuote.update({
      where: { id: q.body.id },
      data: { createdAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 5 * 60_000) },
    });
    const res = await http().post('/checkout/orders').set('authorization', `Bearer ${customer}`)
      .set('Idempotency-Key', randomUUID()).send({ quoteId: q.body.id }).expect(400);
    expect(res.body.error).toBe('QUOTE_EXPIRED');
  });

  it('lets the public catalogue be cached briefly, and the customer data never', async () => {
    const pub = await http().get('/catalog/products?limit=5').expect(200);
    expect(pub.headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=300');
    const mine = await as(customer).get('/orders').expect(200);
    expect(mine.headers['cache-control'] ?? '').not.toContain('public');
  });
});

async function seed(prisma: PrismaService) {
  const stamp = Date.now();
  await prisma.currency.upsert({
    where: { code: 'USD' }, update: {},
    create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
  });
  await prisma.currency.upsert({
    where: { code: 'MRU' }, update: { isActive: true },
    create: { code: 'MRU', nameAr: 'أوقية', nameEn: 'Ouguiya', symbol: 'MRU', decimals: 0 },
  });
  await prisma.fxRate.create({ data: { baseCurrency: 'USD', quoteCurrency: 'MRU', rate: 39.8, source: 'MANUAL' } });
  for (const name of ['customer', 'super_admin']) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name, isSystem: true } });
  }
  await prisma.systemSetting.upsert({
    where: { key: MANUAL_ACCOUNTS_KEY },
    update: {},
    create: {
      key: MANUAL_ACCOUNTS_KEY,
      value: [{ id: 'bankily', method: 'Bankily', countries: ['MR'], accountName: 'patron', accountNumber: '22227268', kind: 'mobile', enabled: true }],
    },
  });
  const category = await prisma.category.create({ data: { slug: `money-${stamp}`, nameAr: 'فئة', nameEn: 'Category' } });
  const game = await prisma.game.create({
    data: {
      slug: `money-game-${stamp}`, nameAr: 'لعبة', nameEn: 'Game', categoryId: category.id,
      inputSchema: [{ key: 'player_id', labelAr: 'معرّف اللاعب', labelEn: 'Player ID', type: 'text', required: true, regex: '^[0-9]{8,12}$' }],
    },
  });
  const product = await prisma.product.create({
    data: {
      sku: `MONEY-${stamp}`, type: 'GAME_TOPUP', delivery: 'MANUAL', nameAr: 'ببجي 60', nameEn: 'PUBG 60', currency: 'USD',
      sellPrice: 1, costPrice: 0.5, categoryId: category.id, gameId: game.id,
      prices: { create: [{ currencyCode: 'MRU', sellPrice: 40 }] },
    },
  });
  return product.id;
}
