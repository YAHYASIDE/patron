import { randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { UsdtService, MAX_OPEN_ORDERS } from '../../src/modules/usdt/usdt.service';
import { UsdtConfigService } from '../../src/modules/usdt/usdt-config.service';
import { toChecksumAddress, tronAddressFromBytes } from '../../src/modules/usdt/usdt-address';
import { DEFAULT_USDT_CONFIG, UsdtConfig } from '../../src/modules/usdt/usdt-rules';

const D = (v: string | number) => new Prisma.Decimal(v);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const ON: UsdtConfig = {
  ...DEFAULT_USDT_CONFIG,
  enabled: true,
  rates: { MRU: '40', USD: '1.02' },
  feePercent: '2',
  feeFixedUsdt: '0.5',
  minUsdt: '10',
  maxUsdt: '500',
  networks: { TRC20: true, BEP20: true, ERC20: false },
  binanceEnabled: true,
};

function order(over: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    number: 'USDT-20261020-000001',
    userId: 'u1',
    status: 'AWAITING_PAYMENT',
    amountUsdt: D('100'),
    delivery: 'ONCHAIN',
    network: 'TRC20',
    address: 'Tx',
    binanceId: null,
    rate: D('40'),
    currency: 'MRU',
    subtotal: D('4000'),
    fee: D('100'),
    total: D('4100'),
    paymentMethod: null,
    payerPhone: null,
    paymentRef: null,
    proofUploadId: null,
    txid: null,
    rejectReason: null,
    reviewedById: null,
    idempotencyKey: 'u1:key',
    expiresAt: new Date(Date.now() + 60_000),
    paidAt: null,
    approvedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    events: [],
    ...over,
  };
}

function setup(config: UsdtConfig = ON) {
  const prisma: any = {
    user: {
      findFirst: jest.fn().mockResolvedValue({ phoneVerifiedAt: new Date() }),
      findMany: jest.fn().mockResolvedValue([{ id: 'staff1', fullName: 'Owner' }]),
    },
    currency: { findFirst: jest.fn().mockResolvedValue({ decimals: 2 }) },
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue({
        value: [
          { id: 'acc1', method: 'Bankily', accountNumber: '20000000', kind: 'mobile', enabled: true, countries: ['MR'] },
          { id: 'acc2', method: 'Off', accountNumber: '', kind: 'mobile', enabled: false },
          { id: 'acc3', method: 'Binance Pay', accountNumber: '1234567', kind: 'crypto', enabled: true },
        ],
      }),
    },
    usdtOrder: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      groupBy: jest.fn().mockResolvedValue([{ status: 'UNDER_REVIEW', _count: { _all: 2 } }]),
    },
    usdtOrderEvent: { create: jest.fn() },
    upload: { create: jest.fn().mockResolvedValue({ id: 'up1' }), deleteMany: jest.fn(), findFirst: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  const audit = { record: jest.fn() };
  const cfg = new UsdtConfigService(prisma, audit as never);
  jest.spyOn(cfg, 'get').mockResolvedValue(config);
  const staff = { notify: jest.fn(), resolve: jest.fn() };
  const service = new UsdtService(prisma, audit as never, cfg, staff as never);
  return { prisma, audit, staff, service };
}

const quoteDto = (over: Record<string, unknown> = {}) =>
  ({ amountUsdt: '100', currency: 'MRU', delivery: 'ONCHAIN', network: 'TRC20', ...over }) as never;

describe('UsdtService — quote', () => {
  it('answers USDT_DISABLED while the owner has not switched it on', async () => {
    const { service } = setup({ ...ON, enabled: false });
    await expect(service.quote('u1', quoteDto())).rejects.toMatchObject({ response: { error: 'USDT_DISABLED' } });
  });

  it('needs a verified WhatsApp number, like checkout', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue({ phoneVerifiedAt: null });
    await expect(service.quote('u1', quoteDto())).rejects.toMatchObject({ response: { error: 'PHONE_NOT_VERIFIED' } });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.quote('u1', quoteDto())).rejects.toMatchObject({ response: { error: 'ACCOUNT_NOT_FOUND' } });
  });

  it('is not offered where buying crypto is a crime (Algerian numbers)', async () => {
    const { service, prisma } = setup();
    prisma.user.findFirst.mockResolvedValue({ phoneVerifiedAt: new Date(), phone: '+213550000000' });
    await expect(service.quote('u1', quoteDto())).rejects.toMatchObject({ response: { error: 'USDT_COUNTRY_BLOCKED' } });
  });

  it('computes rate, fee and total on the server', async () => {
    const { service } = setup();
    const q = await service.quote('u1', quoteDto());
    // 100 × 40 = 4000; fee 2% = 80 + 0.5 × 40 = 20 → 100
    expect(q).toMatchObject({ rate: '40', subtotal: '4000', fee: '100', total: '4100', network: 'TRC20', amountUsdt: '100.00' });
  });

  it.each([
    [{ amountUsdt: '9.99' }, 'USDT_AMOUNT_OUT_OF_RANGE'],
    [{ amountUsdt: '500.01' }, 'USDT_AMOUNT_OUT_OF_RANGE'],
    [{ currency: 'EUR' }, 'USDT_CURRENCY_UNSUPPORTED'],
    [{ network: undefined }, 'USDT_NETWORK_REQUIRED'],
    [{ network: 'ERC20' }, 'USDT_NETWORK_DISABLED'],
  ])('refuses %j with %s', async (over, code) => {
    const { service } = setup();
    await expect(service.quote('u1', quoteDto(over))).rejects.toMatchObject({ response: { error: code } });
  });

  it('refuses a currency the shop has switched off', async () => {
    const { service, prisma } = setup();
    prisma.currency.findFirst.mockResolvedValue(null);
    await expect(service.quote('u1', quoteDto())).rejects.toMatchObject({ response: { error: 'USDT_CURRENCY_UNSUPPORTED' } });
  });

  it('Binance delivery has no network and can be switched off', async () => {
    const { service } = setup();
    const q = await service.quote('u1', quoteDto({ delivery: 'BINANCE', network: 'TRC20' }));
    expect(q.network).toBeNull();
    const off = setup({ ...ON, binanceEnabled: false });
    await expect(off.service.quote('u1', quoteDto({ delivery: 'BINANCE' }))).rejects.toMatchObject({
      response: { error: 'USDT_BINANCE_DISABLED' },
    });
  });
});

describe('UsdtService — create', () => {
  const tron = () => tronAddressFromBytes(randomBytes(20));

  function withCreate(s: ReturnType<typeof setup>) {
    s.prisma.usdtOrder.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...order(), ...data, id: 'o1' }));
    s.prisma.usdtOrder.findFirst.mockImplementation(() => order({ id: 'o1' }));
    return s;
  }

  it('requires an Idempotency-Key', async () => {
    const { service } = setup();
    await expect(service.create('u1', undefined, quoteDto())).rejects.toMatchObject({ response: { error: 'IDEMPOTENCY_KEY_REQUIRED' } });
  });

  it('returns the existing order for a key already used by this customer', async () => {
    const s = withCreate(setup({ ...ON, enabled: false }));
    s.prisma.usdtOrder.findUnique.mockResolvedValue(order({ id: 'o1' }));
    const res = await s.service.create('u1', 'same-key-123', quoteDto());
    expect(res.id).toBe('o1');
    expect(s.prisma.usdtOrder.findUnique).toHaveBeenCalledWith({ where: { idempotencyKey: 'u1:same-key-123' } });
    expect(s.prisma.usdtOrder.create).not.toHaveBeenCalled();
  });

  it('freezes rate, fee, total and the deadline, and records the event and audit', async () => {
    const s = withCreate(setup());
    const address = tron();
    await s.service.create('u1', 'key-12345678', quoteDto({ address }));
    const data = s.prisma.usdtOrder.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'AWAITING_PAYMENT', address, binanceId: null, currency: 'MRU', idempotencyKey: 'u1:key-12345678' });
    expect(data.number).toMatch(/^USDT-\d{8}-\d{6}$/);
    expect(data.total.toString()).toBe('4100');
    expect(data.rate.toString()).toBe('40');
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(s.prisma.usdtOrderEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'created', fromStatus: 'NEW', toStatus: 'AWAITING_PAYMENT' });
    expect(s.audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.order.create', entityType: 'UsdtOrder' });
  });

  it('stores the EIP-55 form of an EVM address', async () => {
    const s = withCreate(setup());
    const checksummed = toChecksumAddress(`0x${randomBytes(20).toString('hex')}`);
    await s.service.create('u1', 'key-12345678', quoteDto({ network: 'BEP20', address: checksummed.toLowerCase() }));
    expect(s.prisma.usdtOrder.create.mock.calls[0][0].data.address).toBe(checksummed);
  });

  it('refuses an address from another network with a clear code', async () => {
    const s = withCreate(setup());
    await expect(s.service.create('u1', 'key-12345678', quoteDto({ network: 'BEP20', address: tron() }))).rejects.toMatchObject({
      response: { error: 'USDT_ADDRESS_WRONG_NETWORK', network: 'BEP20' },
    });
  });

  it('Binance delivery keeps the id and no address', async () => {
    const s = withCreate(setup());
    await s.service.create('u1', 'key-12345678', quoteDto({ delivery: 'BINANCE', network: undefined, binanceId: '87654321', address: 'ignored' }));
    expect(s.prisma.usdtOrder.create.mock.calls[0][0].data).toMatchObject({ binanceId: '87654321', address: null, network: null });
    await expect(s.service.create('u1', 'key-22345678', quoteDto({ delivery: 'BINANCE', binanceId: 'no' }))).rejects.toMatchObject({
      response: { error: 'USDT_BINANCE_ID_INVALID' },
    });
  });

  it('refuses when the total the customer saw is no longer the price', async () => {
    const s = withCreate(setup());
    await expect(s.service.create('u1', 'key-12345678', quoteDto({ address: tron(), expectedTotal: '4000' }))).rejects.toMatchObject({
      response: { error: 'USDT_QUOTE_CHANGED', total: '4100' },
    });
    await expect(s.service.create('u1', 'key-22345678', quoteDto({ address: tron(), expectedTotal: '4100.00' }))).resolves.toBeDefined();
  });

  it(`limits a customer to ${MAX_OPEN_ORDERS} unpaid orders`, async () => {
    const s = withCreate(setup());
    s.prisma.usdtOrder.count.mockResolvedValue(MAX_OPEN_ORDERS);
    await expect(s.service.create('u1', 'key-12345678', quoteDto({ address: tron() }))).rejects.toMatchObject({
      response: { error: 'USDT_TOO_MANY_OPEN' },
    });
  });

  it('answers a concurrent duplicate key with the order that won', async () => {
    const s = withCreate(setup());
    s.prisma.usdtOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['idempotencyKey'] } }),
    );
    s.prisma.usdtOrder.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(order({ id: 'o1' }));
    const res = await s.service.create('u1', 'key-12345678', quoteDto({ address: tron() }));
    expect(res.id).toBe('o1');
  });

  it('retries a clashing order number and rethrows anything else', async () => {
    const s = withCreate(setup());
    s.prisma.usdtOrder.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['number'] } }),
    );
    await expect(s.service.create('u1', 'key-12345678', quoteDto({ address: tron() }))).resolves.toBeDefined();
    expect(s.prisma.usdtOrder.create).toHaveBeenCalledTimes(2);

    s.prisma.usdtOrder.create.mockRejectedValueOnce(new Error('db down'));
    await expect(s.service.create('u1', 'key-22345678', quoteDto({ address: tron() }))).rejects.toThrow('db down');
  });
});

describe('UsdtService — customer reads', () => {
  it('hides staff fields and shows only the rejection note', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findFirst.mockResolvedValue(
      order({
        status: 'REJECTED',
        proofUploadId: 'up1',
        events: [
          { action: 'created', toStatus: 'AWAITING_PAYMENT', note: null, createdAt: new Date() },
          { action: 'rejected', toStatus: 'REJECTED', note: 'No transfer found', createdAt: new Date() },
          { action: 'approved', toStatus: 'READY_TO_SEND', note: 'internal', createdAt: new Date() },
        ],
      }),
    );
    const res: any = await service.forCustomer('o1', 'u1');
    expect(res.hasProof).toBe(true);
    expect(res).not.toHaveProperty('idempotencyKey');
    expect(res).not.toHaveProperty('reviewedById');
    expect(res.events[1]).toMatchObject({ action: 'rejected', note: 'No transfer found' });
    expect(res.events[2]).not.toHaveProperty('note');
  });

  it('treats another customer’s order as missing', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findFirst.mockResolvedValue(null);
    await expect(service.forCustomer('o1', 'u2')).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
  });

  it('lists the customer’s own orders', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findMany.mockResolvedValue([order()]);
    const rows = await service.listMine('u1');
    expect(rows).toHaveLength(1);
    expect(prisma.usdtOrder.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });
});

describe('UsdtService — receipt and payment', () => {
  const file = { buffer: PNG, size: PNG.length };

  it('stores the receipt privately and replaces an earlier one', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ proofUploadId: 'old' }));
    await expect(service.attachProof('u1', 'o1', file)).resolves.toEqual({ proofId: 'up1' });
    expect(prisma.upload.deleteMany).toHaveBeenCalledWith({ where: { id: 'old', kind: 'usdt_proof' } });
    expect(prisma.upload.create.mock.calls[0][0].data).toMatchObject({ kind: 'usdt_proof', isPublic: false, mime: 'image/png', userId: 'u1' });
    expect(prisma.usdtOrder.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { proofUploadId: 'up1' } });
  });

  it('refuses missing, oversized or non-image files, other people’s orders, and closed orders', async () => {
    const { service, prisma } = setup();
    await expect(service.attachProof('u1', 'o1', undefined)).rejects.toMatchObject({ response: { error: 'USDT_PROOF_REQUIRED' } });
    await expect(service.attachProof('u1', 'o1', { buffer: PNG, size: 5 * 1024 * 1024 })).rejects.toMatchObject({ response: { error: 'UPLOAD_TOO_LARGE' } });
    await expect(service.attachProof('u1', 'o1', { buffer: Buffer.from('<script>'), size: 8 })).rejects.toMatchObject({ response: { error: 'UPLOAD_TYPE' } });
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ userId: 'u2' }));
    await expect(service.attachProof('u1', 'o1', file)).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ status: 'COMPLETED' }));
    await expect(service.attachProof('u1', 'o1', file)).rejects.toMatchObject({ response: { error: 'USDT_INVALID_STATUS' } });
    prisma.usdtOrder.findUnique.mockResolvedValue(null);
    await expect(service.attachProof('u1', 'o1', file)).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
  });

  it('moves to UNDER_REVIEW with the account, and raises a staff notice', async () => {
    const { service, prisma, staff, audit } = setup();
    const o = order({ proofUploadId: 'up1' });
    prisma.usdtOrder.findUnique.mockResolvedValue(o);
    prisma.usdtOrder.findFirst.mockResolvedValue(o);
    await service.submitPayment('u1', o.id, { method: 'acc1', payerPhone: '22000000', reference: 'R1' } as never);
    const upd = prisma.usdtOrder.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: o.id, status: 'AWAITING_PAYMENT' });
    expect(upd.data).toMatchObject({ status: 'UNDER_REVIEW', paymentMethod: 'Bankily', payerPhone: '22000000', paymentRef: 'R1' });
    expect(prisma.usdtOrderEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'payment.submitted', toStatus: 'UNDER_REVIEW' });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.order.payment' });
    expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'usdt.review', dedupeKey: `usdt.review:${o.id}`, priority: 'HIGH' }));
  });

  it('lets the customer correct the details while under review (no new transition)', async () => {
    const { service, prisma } = setup();
    const o = order({ status: 'UNDER_REVIEW', proofUploadId: 'up1' });
    prisma.usdtOrder.findUnique.mockResolvedValue(o);
    prisma.usdtOrder.findFirst.mockResolvedValue(o);
    await service.submitPayment('u1', o.id, { method: 'acc1', payerPhone: '22000001' } as never);
    expect(prisma.usdtOrder.updateMany).not.toHaveBeenCalled();
    expect(prisma.usdtOrder.update.mock.calls[0][0].data).toMatchObject({ payerPhone: '22000001', paymentRef: null });
    expect(prisma.usdtOrderEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'payment.updated' });
  });

  it('needs the receipt, a usable non-crypto account, and an open order', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findUnique.mockResolvedValue(order());
    await expect(service.submitPayment('u1', 'o1', { method: 'acc1', payerPhone: '2200' } as never)).rejects.toMatchObject({
      response: { error: 'USDT_PROOF_REQUIRED' },
    });
    for (const method of ['acc2', 'acc3', 'nope']) {
      await expect(service.submitPayment('u1', 'o1', { method, payerPhone: '2200' } as never)).rejects.toMatchObject({
        response: { error: 'USDT_PAYMENT_METHOD_UNKNOWN' },
      });
    }
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ status: 'READY_TO_SEND', proofUploadId: 'up1' }));
    await expect(service.submitPayment('u1', 'o1', { method: 'acc1', payerPhone: '2200' } as never)).rejects.toMatchObject({
      response: { error: 'USDT_INVALID_STATUS' },
    });
  });

  it('treats an empty account list as no account', async () => {
    const { service, prisma } = setup();
    prisma.systemSetting.findUnique.mockResolvedValue(null);
    await expect(service.submitPayment('u1', 'o1', { method: 'acc1', payerPhone: '2200' } as never)).rejects.toMatchObject({
      response: { error: 'USDT_PAYMENT_METHOD_UNKNOWN' },
    });
  });

  it('expires an order paid after its deadline instead of taking the report', async () => {
    const { service, prisma, staff } = setup();
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ proofUploadId: 'up1', expiresAt: new Date(Date.now() - 1000) }));
    await expect(service.submitPayment('u1', 'o1', { method: 'acc1', payerPhone: '2200' } as never)).rejects.toMatchObject({
      response: { error: 'USDT_ORDER_EXPIRED' },
    });
    expect(prisma.usdtOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });
    expect(staff.notify).not.toHaveBeenCalled();
  });

  it('cancels only an unpaid order', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findUnique.mockResolvedValue(order());
    prisma.usdtOrder.findFirst.mockResolvedValue(order({ status: 'CANCELLED' }));
    await service.cancel('u1', 'o1');
    expect(prisma.usdtOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CANCELLED' });
    prisma.usdtOrder.findUnique.mockResolvedValue(order({ status: 'UNDER_REVIEW' }));
    await expect(service.cancel('u1', 'o1')).rejects.toMatchObject({ response: { error: 'USDT_INVALID_STATUS' } });
  });

  it('loses a race cleanly when the status changed under it', async () => {
    const { service, prisma } = setup();
    prisma.usdtOrder.findUnique.mockResolvedValue(order());
    prisma.usdtOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('u1', 'o1')).rejects.toMatchObject({ response: { error: 'USDT_INVALID_STATUS' } });
  });
});

describe('UsdtService — staff', () => {
  function withDetail(s: ReturnType<typeof setup>, o: ReturnType<typeof order>) {
    s.prisma.usdtOrder.findUnique.mockImplementation((args: { where: { id?: string; txid?: string } }) =>
      args.where.txid ? null : { ...o, user: { id: 'u1' }, reviewedBy: null, events: [{ id: 'e1', actorId: 'staff1', action: 'approved', createdAt: new Date() }] },
    );
    s.prisma.usdtOrder.count.mockResolvedValue(2);
    return s;
  }

  it('approves an order under review: READY_TO_SEND, review notice closed, send notice raised', async () => {
    const o = order({ status: 'UNDER_REVIEW', proofUploadId: 'up1' });
    const s = withDetail(setup(), o);
    const res: any = await s.service.approve('staff1', o.id);
    expect(s.prisma.usdtOrder.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: o.id, status: 'UNDER_REVIEW' },
      data: { status: 'READY_TO_SEND', reviewedById: 'staff1' },
    });
    expect(s.audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.approved', actorId: 'staff1' });
    expect(s.staff.resolve).toHaveBeenCalledWith(`usdt.review:${o.id}`);
    expect(s.staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'usdt.send', dedupeKey: `usdt.send:${o.id}` }));
    expect(res.events[0].actorName).toBe('Owner');
    expect(res.previousCompleted).toBe(2);
    expect(res).not.toHaveProperty('idempotencyKey');
  });

  it('names the Binance recipient in the send notice', async () => {
    const o = order({ status: 'UNDER_REVIEW', proofUploadId: 'up1', delivery: 'BINANCE', network: null, binanceId: '87654321' });
    const s = withDetail(setup(), o);
    await s.service.approve('staff1', o.id);
    expect(s.staff.notify.mock.calls[0][0].body).toContain('Binance 87654321');
  });

  it('will not approve twice or before payment', async () => {
    const s = withDetail(setup(), order({ status: 'READY_TO_SEND', proofUploadId: 'up1' }));
    await expect(s.service.approve('staff1', 'o1')).rejects.toMatchObject({ response: { error: 'USDT_INVALID_STATUS' } });
    const s2 = withDetail(setup(), order({ status: 'UNDER_REVIEW', proofUploadId: null }));
    await expect(s2.service.approve('staff1', 'o1')).rejects.toMatchObject({ response: { error: 'USDT_PROOF_REQUIRED' } });
  });

  it('completes with a TXID in the network’s format and closes the send notice', async () => {
    const o = order({ status: 'READY_TO_SEND', proofUploadId: 'up1' });
    const s = withDetail(setup(), o);
    const txid = randomBytes(32).toString('hex').toUpperCase();
    await s.service.complete('staff1', o.id, txid);
    expect(s.prisma.usdtOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', txid: txid.toLowerCase() });
    expect(s.staff.resolve).toHaveBeenCalledWith(`usdt.send:${o.id}`);
  });

  it('refuses a malformed or already used TXID', async () => {
    const o = order({ status: 'READY_TO_SEND', network: 'BEP20' });
    const s = withDetail(setup(), o);
    await expect(s.service.complete('staff1', o.id, randomBytes(32).toString('hex'))).rejects.toMatchObject({
      response: { error: 'USDT_TXID_INVALID' },
    });
    s.prisma.usdtOrder.findUnique.mockImplementation((args: { where: { txid?: string } }) => (args.where.txid ? { number: 'USDT-X' } : o));
    await expect(s.service.complete('staff1', o.id, `0x${randomBytes(32).toString('hex')}`)).rejects.toMatchObject({
      response: { error: 'USDT_TXID_DUPLICATE' },
    });
  });

  it('maps a unique-index race on the TXID to USDT_TXID_DUPLICATE', async () => {
    const o = order({ status: 'READY_TO_SEND' });
    const s = withDetail(setup(), o);
    s.prisma.usdtOrder.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: ['txid'] } }),
    );
    await expect(s.service.complete('staff1', o.id, randomBytes(32).toString('hex'))).rejects.toMatchObject({
      response: { error: 'USDT_TXID_DUPLICATE' },
    });
  });

  it('will not complete an order that was not approved', async () => {
    const s = withDetail(setup(), order({ status: 'UNDER_REVIEW' }));
    await expect(s.service.complete('staff1', 'o1', randomBytes(32).toString('hex'))).rejects.toMatchObject({
      response: { error: 'USDT_INVALID_STATUS' },
    });
  });

  it('rejects with a reason and closes both notices; a final order cannot be rejected', async () => {
    const o = order({ status: 'READY_TO_SEND' });
    const s = withDetail(setup(), o);
    await s.service.reject('staff1', o.id, 'Payment not received');
    expect(s.prisma.usdtOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', rejectReason: 'Payment not received' });
    expect(s.prisma.usdtOrderEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'rejected', note: 'Payment not received' });
    expect(s.staff.resolve).toHaveBeenCalledWith(`usdt.review:${o.id}`);
    expect(s.staff.resolve).toHaveBeenCalledWith(`usdt.send:${o.id}`);

    const done = withDetail(setup(), order({ status: 'COMPLETED' }));
    await expect(done.service.reject('staff1', 'o1', 'late')).rejects.toMatchObject({ response: { error: 'USDT_INVALID_STATUS' } });
  });

  it('lists by status with counts, oldest first for a work queue', async () => {
    const s = setup();
    s.prisma.usdtOrder.findMany.mockResolvedValue([{ ...order(), user: { id: 'u1', fullName: 'C', phone: '+222' } }]);
    s.prisma.usdtOrder.count.mockResolvedValue(1);
    const res = await s.service.list({ status: 'UNDER_REVIEW', search: '+222 2000' } as never);
    const args = s.prisma.usdtOrder.findMany.mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
    expect(args.where.status).toBe('UNDER_REVIEW');
    expect(args.where.OR).toHaveLength(5);
    expect(res.counts).toEqual({ UNDER_REVIEW: 2 });
    expect(res.data[0]).not.toHaveProperty('idempotencyKey');

    await s.service.list({} as never);
    expect(s.prisma.usdtOrder.findMany.mock.calls[1][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('serves the receipt only when there is one', async () => {
    const s = setup();
    s.prisma.usdtOrder.findUnique.mockResolvedValue({ proofUploadId: 'up1' });
    s.prisma.upload.findFirst.mockResolvedValue({ mime: 'image/png', data: PNG });
    await expect(s.service.proof('o1')).resolves.toMatchObject({ mime: 'image/png' });
    s.prisma.usdtOrder.findUnique.mockResolvedValue({ proofUploadId: null });
    await expect(s.service.proof('o1')).rejects.toMatchObject({ response: { error: 'USDT_PROOF_MISSING' } });
    s.prisma.usdtOrder.findUnique.mockResolvedValue(null);
    await expect(s.service.proof('o1')).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
    await expect(s.service.detail('o1')).rejects.toMatchObject({ response: { error: 'USDT_ORDER_NOT_FOUND' } });
  });
});

describe('UsdtService — expiry', () => {
  it('cancels unpaid orders past their deadline and skips ones paid in the meantime', async () => {
    const s = setup();
    const past = new Date(Date.now() - 60_000);
    s.prisma.usdtOrder.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    s.prisma.usdtOrder.findUnique
      .mockResolvedValueOnce(order({ id: 'a', expiresAt: past }))
      .mockResolvedValueOnce(order({ id: 'b', status: 'UNDER_REVIEW', expiresAt: past }))
      .mockRejectedValueOnce(new Error('lock timeout'));
    expect(await s.service.expireUnpaid()).toBe(1);
    expect(s.prisma.usdtOrder.updateMany).toHaveBeenCalledTimes(1);
    expect(s.prisma.usdtOrderEvent.create.mock.calls[0][0].data).toMatchObject({ action: 'expired', actorId: null, toStatus: 'CANCELLED' });
    expect(s.audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.order.expire' });
  });
});
