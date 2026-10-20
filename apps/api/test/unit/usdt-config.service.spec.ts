import { UsdtConfigService } from '../../src/modules/usdt/usdt-config.service';
import { DEFAULT_USDT_CONFIG } from '../../src/modules/usdt/usdt-rules';
import { UsdtAdminController, UsdtController } from '../../src/modules/usdt/usdt.controller';
import { EXPIRE_USDT_JOB, UsdtExpiryProcessor } from '../../src/modules/usdt/usdt-expiry.processor';

function setup(stored: unknown = null) {
  const prisma: any = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(stored === null ? null : { value: stored }), upsert: jest.fn() },
    currency: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { code: { in: string[] } } }) =>
        where.code.in.filter((c) => ['MRU', 'USD'].includes(c)).map((code) => ({ code, decimals: code === 'MRU' ? 2 : 2 })),
      ),
    },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  const audit = { record: jest.fn() };
  return { prisma, audit, service: new UsdtConfigService(prisma, audit as never) };
}

const dto = (over: Record<string, unknown> = {}) =>
  ({
    enabled: false,
    rates: { MRU: '41.5' },
    feePercent: '2',
    feeFixedUsdt: '0.5',
    minUsdt: '10',
    maxUsdt: '1000',
    networks: { TRC20: true, BEP20: true, ERC20: false },
    binanceEnabled: true,
    expiryMinutes: 30,
    ...over,
  }) as never;

describe('UsdtConfigService', () => {
  it('is off by default', async () => {
    const { service } = setup();
    expect(await service.get()).toEqual(DEFAULT_USDT_CONFIG);
    await expect(service.requireEnabled()).rejects.toMatchObject({ response: { error: 'USDT_DISABLED' } });
    expect(await service.publicSummary()).toEqual({ enabled: false });
  });

  it('shows the store only active currencies and enabled networks', async () => {
    const { service } = setup({ ...DEFAULT_USDT_CONFIG, enabled: true, rates: { MRU: '41.5', XOF: '600' } });
    const s = await service.publicSummary();
    expect(s).toMatchObject({ enabled: true, networks: ['TRC20', 'BEP20'], binanceEnabled: true, minUsdt: '10' });
    expect((s as { currencies: unknown[] }).currencies).toEqual([{ code: 'MRU', rate: '41.5', decimals: 2 }]);
    await expect(service.requireEnabled()).resolves.toMatchObject({ enabled: true });
  });

  it('saves the terms and audits the change', async () => {
    const { service, prisma, audit } = setup();
    const saved = await service.update(dto({ rates: { mru: '41.5', USD: '' } }), 'owner');
    expect(saved.rates).toEqual({ MRU: '41.5' });
    expect(prisma.systemSetting.upsert.mock.calls[0][0].where).toEqual({ key: 'usdt.config' });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.config.update', actorId: 'owner' });
  });

  it('switching on needs the owner’s legal approval, a rate and a delivery option', async () => {
    const { service, audit } = setup();
    await expect(service.update(dto({ enabled: true }), 'owner')).rejects.toMatchObject({ response: { error: 'USDT_LEGAL_ACK_REQUIRED' } });
    await expect(service.update(dto({ enabled: true, legalApproval: true, rates: {} }), 'owner')).rejects.toMatchObject({
      response: { error: 'USDT_CONFIG_INVALID' },
    });
    await expect(
      service.update(dto({ enabled: true, legalApproval: true, binanceEnabled: false, networks: { TRC20: false, BEP20: false, ERC20: false } }), 'owner'),
    ).rejects.toMatchObject({ response: { error: 'USDT_CONFIG_INVALID' } });
    await service.update(dto({ enabled: true, legalApproval: true }), 'owner');
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'usdt.config.enable' });
  });

  it('does not ask again while it stays on, and audits switching off', async () => {
    const { service, audit } = setup({ ...DEFAULT_USDT_CONFIG, enabled: true, rates: { MRU: '41' } });
    await expect(service.update(dto({ enabled: true }), 'owner')).resolves.toMatchObject({ enabled: true });
    await service.update(dto({ enabled: false }), 'owner');
    expect(audit.record.mock.calls[1][1]).toMatchObject({ action: 'usdt.config.disable' });
  });

  it.each([
    [{ rates: { MONEY: '1' } }],
    [{ rates: { MRU: '0' } }],
    [{ rates: { MRU: 'abc' } }],
    [{ rates: { EUR: '1' } }],
    [{ feePercent: '51' }],
    [{ feeFixedUsdt: '1001' }],
    [{ minUsdt: '0.5' }],
    [{ minUsdt: '100', maxUsdt: '50' }],
    [{ maxUsdt: '2000000' }],
  ])('refuses %j', async (over) => {
    const { service } = setup();
    await expect(service.update(dto(over), 'owner')).rejects.toMatchObject({ response: { error: 'USDT_CONFIG_INVALID' } });
  });
});

describe('USDT controllers', () => {
  const usdt: any = {
    quote: jest.fn().mockResolvedValue('q'),
    create: jest.fn().mockResolvedValue('o'),
    listMine: jest.fn().mockResolvedValue([]),
    forCustomer: jest.fn().mockResolvedValue('one'),
    attachProof: jest.fn().mockResolvedValue({ proofId: 'p' }),
    submitPayment: jest.fn().mockResolvedValue('paid'),
    cancel: jest.fn().mockResolvedValue('cancelled'),
    list: jest.fn().mockResolvedValue('list'),
    detail: jest.fn().mockResolvedValue('detail'),
    proof: jest.fn().mockResolvedValue({ mime: 'image/png', data: new Uint8Array([1]) }),
    approve: jest.fn().mockResolvedValue('approved'),
    complete: jest.fn().mockResolvedValue('completed'),
    reject: jest.fn().mockResolvedValue('rejected'),
  };
  const config: any = { publicSummary: jest.fn().mockResolvedValue({ enabled: false }), get: jest.fn().mockResolvedValue('cfg'), update: jest.fn().mockResolvedValue('saved') };

  it('customer routes pass the signed-in user and the Idempotency-Key through', async () => {
    const c = new UsdtController(usdt, config);
    expect(await c.publicConfig()).toEqual({ enabled: false });
    await c.quote('u1', { amountUsdt: '10' } as never);
    expect(usdt.quote).toHaveBeenCalledWith('u1', { amountUsdt: '10' });
    await c.create('u1', 'key-1', {} as never);
    expect(usdt.create).toHaveBeenCalledWith('u1', 'key-1', {});
    await c.mine('u1');
    await c.one('u1', 'o1');
    expect(usdt.forCustomer).toHaveBeenCalledWith('o1', 'u1');
    await c.proof('u1', 'o1', { buffer: Buffer.alloc(1), size: 1 });
    await c.pay('u1', 'o1', { method: 'a', payerPhone: '1234' } as never);
    expect(usdt.submitPayment).toHaveBeenCalledWith('u1', 'o1', { method: 'a', payerPhone: '1234' });
    await c.cancel('u1', 'o1');
    expect(usdt.cancel).toHaveBeenCalledWith('u1', 'o1');
  });

  it('staff routes pass the actor', async () => {
    const c = new UsdtAdminController(usdt, config);
    expect(await c.getConfig()).toBe('cfg');
    await c.setConfig({} as never, 's1');
    expect(config.update).toHaveBeenCalledWith({}, 's1');
    await c.list({} as never);
    await c.detail('o1');
    await c.approve('o1', 's1');
    expect(usdt.approve).toHaveBeenCalledWith('s1', 'o1');
    await c.complete('o1', { txid: 'abc' } as never, 's1');
    expect(usdt.complete).toHaveBeenCalledWith('s1', 'o1', 'abc');
    await c.reject('o1', { reason: 'no money' } as never, 's1');
    expect(usdt.reject).toHaveBeenCalledWith('s1', 'o1', 'no money');
    const res = { setHeader: jest.fn(), end: jest.fn() };
    await c.receipt('o1', res as never);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});

describe('UsdtExpiryProcessor', () => {
  it('runs the expiry sweep and refuses unknown jobs', async () => {
    const usdt = { expireUnpaid: jest.fn().mockResolvedValue(3) };
    const queue = { add: jest.fn() };
    const p = new UsdtExpiryProcessor(usdt as never, queue as never);
    await expect(p.process({ name: EXPIRE_USDT_JOB } as never)).resolves.toEqual({ expired: 3 });
    await expect(p.process({ name: 'other' } as never)).rejects.toThrow('Unknown usdt job');
  });

  it('schedules itself outside tests only', async () => {
    const queue = { add: jest.fn() };
    const p = new UsdtExpiryProcessor({} as never, queue as never);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    await p.onModuleInit();
    expect(queue.add).not.toHaveBeenCalled();
    process.env.NODE_ENV = 'production';
    await p.onModuleInit();
    expect(queue.add).toHaveBeenCalledWith(EXPIRE_USDT_JOB, {}, expect.objectContaining({ jobId: `cron-${EXPIRE_USDT_JOB}`, repeat: { pattern: '*/5 * * * *' } }));
    process.env.NODE_ENV = env;
  });
});
