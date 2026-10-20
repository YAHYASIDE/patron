import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { randomUUID } from 'crypto';

import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { MANUAL_ACCOUNTS_KEY } from '../../src/modules/payments/gateways/manual.gateway';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * The cases a real cart runs into, end to end through HTTP: a product hidden
 * after it went into the cart, a code product with too little stock, a
 * per-order limit, a missing or malformed player ID, ouguiya prices (fixed and
 * from the rate), then paying by transfer (receipt required) and by wallet.
 * A customer once could not order at all because one cart line was hidden;
 * each line problem must name the product and its reason so the store can
 * fix the cart and still complete the order.
 */
describe('Checkout edge cases (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: string;
  const ids: Record<'game' | 'hidden' | 'codes' | 'limited' | 'auto', string> = {} as never;
  const PLAYER = { key: 'player_id', value: '5123456789' };

  // the smallest valid PNG: the receipt upload checks the bytes, not the name
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
    'hex',
  );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // many quotes and payments from one IP in seconds (see checkout.e2e-spec.ts)
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: () => Promise.resolve({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    // the production error envelope (main.ts): without it a filter that drops the details would go unnoticed
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    Object.assign(ids, await seed(prisma));

    // a WhatsApp customer, verified as the owner would after relaying the code
    const phone = `+2224${String(Date.now()).slice(-7)}`;
    const res = await http().post('/auth/phone/start').send({ phone, fullName: 'زبون الحالات الصعبة' }).expect(200);
    token = res.body.accessToken;
    const user = await prisma.user.update({ where: { phone }, data: { phoneVerifiedAt: new Date() } });
    userId = user.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const quote = (items: object[], currency = 'MRU') =>
    http().post('/checkout/quotes').set('authorization', `Bearer ${token}`).send({ items, currency });

  it('names a product hidden after it went into the cart, and quotes the rest', async () => {
    const res = await quote([
      { productId: ids.hidden, quantity: 1 },
      { productId: ids.game, quantity: 1, inputs: [PLAYER] },
    ]).expect(400);
    expect(res.body).toMatchObject({ error: 'PRODUCT_UNAVAILABLE', productId: ids.hidden });

    const rest = await quote([{ productId: ids.game, quantity: 1, inputs: [PLAYER] }]).expect(201);
    expect(rest.body.items).toHaveLength(1);
  });

  it('says how many codes are left when the cart asks for more', async () => {
    const res = await quote([{ productId: ids.codes, quantity: 2 }]).expect(400);
    expect(res.body).toMatchObject({ error: 'OUT_OF_STOCK', available: 1, productId: ids.codes, productNameAr: 'بطاقة بأكواد' });
    await quote([{ productId: ids.codes, quantity: 1 }]).expect(201);
  });

  it('gives the per-order limit so the store can lower the quantity', async () => {
    const res = await quote([{ productId: ids.limited, quantity: 3 }]).expect(400);
    expect(res.body).toMatchObject({ error: 'MAX_PER_ORDER', max: 2, productId: ids.limited });
  });

  it('names the missing or malformed field in Arabic', async () => {
    const missing = await quote([{ productId: ids.game, quantity: 1, inputs: [] }]).expect(400);
    expect(missing.body).toMatchObject({ error: 'INPUT_MISSING', fieldLabelAr: 'معرّف اللاعب', productId: ids.game });

    const bad = await quote([{ productId: ids.game, quantity: 1, inputs: [{ key: 'player_id', value: 'abc' }] }]).expect(400);
    expect(bad.body).toMatchObject({ error: 'INPUT_INVALID', fieldLabelAr: 'معرّف اللاعب' });
  });

  it('prices in ouguiya: a fixed price as set, the others from the rate', async () => {
    const fixed = await quote([{ productId: ids.game, quantity: 1, inputs: [PLAYER] }]).expect(201);
    expect(fixed.body.currency).toBe('MRU');
    expect(Number(fixed.body.total)).toBe(40);

    const auto = await quote([{ productId: ids.auto, quantity: 1 }]).expect(201);
    expect(auto.body.currency).toBe('MRU');
    // 2 $ at 39.8, whatever the rounding rule
    expect(Number(auto.body.total)).toBeGreaterThanOrEqual(79);
    expect(Number(auto.body.total)).toBeLessThanOrEqual(80);
  });

  it('pays by transfer: the receipt is required, then the transfer waits for the owner', async () => {
    const q = await quote([{ productId: ids.game, quantity: 1, inputs: [PLAYER] }]).expect(201);
    const order = await http().post('/checkout/orders').set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID()).send({ quoteId: q.body.id }).expect(201);
    const pay = await http().post('/payments').set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, gateway: 'MANUAL' }).expect(201);
    const paymentId: string = pay.body.paymentId ?? pay.body.id;
    expect(paymentId).toBeDefined();

    const accounts = await http().get('/payments/manual-accounts').expect(200);
    const list = (accounts.body.accounts ?? accounts.body) as Array<{ id: string; method: string; accountNumber: string }>;
    const bankily = list.find((a) => a.method === 'Bankily')!;
    expect(bankily.accountNumber).toBe('22227268');

    const transfer = { accountId: bankily.id, payerPhone: '22123456' };
    const early = await http().post(`/payments/${paymentId}/transfer`).set('authorization', `Bearer ${token}`).send(transfer).expect(400);
    expect(early.body.error).toBe('PROOF_REQUIRED');

    await http().post(`/payments/${paymentId}/proof`).set('authorization', `Bearer ${token}`)
      .attach('file', PNG, { filename: 'receipt.png', contentType: 'image/png' }).expect(200);
    const sent = await http().post(`/payments/${paymentId}/transfer`).set('authorization', `Bearer ${token}`).send(transfer).expect(200);
    expect(sent.body.status).toBe('AUTHORIZED');
  });

  it('pays from the wallet in the same currency and marks the order paid', async () => {
    await prisma.wallet.upsert({
      where: { userId_currencyCode: { userId, currencyCode: 'MRU' } },
      update: { balance: 1000 },
      create: { userId, currencyCode: 'MRU', balance: 1000 },
    });
    const q = await quote([{ productId: ids.game, quantity: 1, inputs: [PLAYER] }]).expect(201);
    const order = await http().post('/checkout/orders').set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID()).send({ quoteId: q.body.id }).expect(201);
    await http().post('/payments').set('authorization', `Bearer ${token}`)
      .set('Idempotency-Key', randomUUID()).send({ orderId: order.body.id, gateway: 'WALLET' }).expect(201);
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.body.id } });
    expect(paid.status).toBe('PAID');
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

  const category = await prisma.category.create({ data: { slug: `edges-${stamp}`, nameAr: 'فئة', nameEn: 'Category' } });
  const gameRow = await prisma.game.create({
    data: {
      slug: `edges-game-${stamp}`, nameAr: 'لعبة', nameEn: 'Game', categoryId: category.id,
      inputSchema: [{ key: 'player_id', labelAr: 'معرّف اللاعب', labelEn: 'Player ID', type: 'text', required: true, regex: '^[0-9]{8,12}$' }],
    },
  });
  const base = { type: 'GAME_TOPUP' as const, currency: 'USD', categoryId: category.id, costPrice: 0.5 };
  const game = await prisma.product.create({
    data: {
      ...base, sku: `EDGE-GAME-${stamp}`, nameAr: 'ببجي 60', nameEn: 'PUBG 60', delivery: 'MANUAL', sellPrice: 1, gameId: gameRow.id,
      prices: { create: [{ currencyCode: 'MRU', sellPrice: 40 }] },
    },
  });
  const hidden = await prisma.product.create({
    data: { ...base, type: 'GIFT_CARD', sku: `EDGE-HIDDEN-${stamp}`, nameAr: 'منتج مخفي', nameEn: 'Hidden', delivery: 'MANUAL', sellPrice: 1, isActive: false },
  });
  const codes = await prisma.product.create({
    data: { ...base, type: 'GIFT_CARD', sku: `EDGE-CODES-${stamp}`, nameAr: 'بطاقة بأكواد', nameEn: 'Coded card', delivery: 'CODE_POOL', sellPrice: 1 },
  });
  await prisma.productCode.create({ data: { productId: codes.id, codeEnc: 'enc-one', codeHash: `hash-${stamp}` } });
  const limited = await prisma.product.create({
    data: { ...base, type: 'GIFT_CARD', sku: `EDGE-LIMIT-${stamp}`, nameAr: 'محدود', nameEn: 'Limited', delivery: 'MANUAL', sellPrice: 1, maxPerOrder: 2 },
  });
  const auto = await prisma.product.create({
    data: { ...base, type: 'GIFT_CARD', sku: `EDGE-AUTO-${stamp}`, nameAr: 'سعر تلقائي', nameEn: 'Auto priced', delivery: 'MANUAL', sellPrice: 2 },
  });
  return { game: game.id, hidden: hidden.id, codes: codes.id, limited: limited.id, auto: auto.id };
}
