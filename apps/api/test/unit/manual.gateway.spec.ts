import { ManualTransferGateway, isUsable, normalizeAccount } from '../../src/modules/payments/gateways/manual.gateway';

describe('ManualTransferGateway', () => {
  let prisma: any;
  let gateway: ManualTransferGateway;

  beforeEach(() => {
    prisma = { systemSetting: { findUnique: jest.fn() }, payment: { findUnique: jest.fn() } };
    gateway = new ManualTransferGateway(prisma);
  });

  it('is offered only once the owner switched on an account with a number', async () => {
    prisma.systemSetting.findUnique.mockResolvedValueOnce(null);
    await expect(gateway.isEnabled()).resolves.toBe(false);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [] });
    await expect(gateway.isEnabled()).resolves.toBe(false);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [{ id: 'a', method: 'Moov', accountNumber: '', enabled: false }] });
    await expect(gateway.isEnabled()).resolves.toBe(false);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [{ id: 'a', method: 'Bankily', accountNumber: '22227268' }] });
    await expect(gateway.isEnabled()).resolves.toBe(true);
  });

  it('reads accounts saved before countries existed', () => {
    const legacy = normalizeAccount({ id: 'a', method: 'Bankily', country: 'MR', accountName: 'X', accountNumber: '1' });
    expect(legacy).toEqual({ id: 'a', method: 'Bankily', countries: ['MR'], accountName: 'X', accountNumber: '1', kind: 'mobile', enabled: true });
    expect(normalizeAccount({ id: 'b', method: 'USDT', countries: ['XX'], kind: 'crypto', logo: 'usdt', enabled: false, instructions: 'TRC20' }))
      .toEqual(expect.objectContaining({ countries: ['XX'], kind: 'crypto', logo: 'usdt', enabled: false, instructions: 'TRC20', accountNumber: '' }));
    expect(normalizeAccount({}).countries).toEqual([]);
    expect(isUsable(legacy)).toBe(true);
    expect(isUsable({ ...legacy, accountNumber: '  ' })).toBe(false);
    expect(isUsable({ ...legacy, enabled: false })).toBe(false);
  });

  it('never settles by itself: initiate asks the customer to act', async () => {
    await expect(gateway.initiate({ paymentId: 'p1' } as any)).resolves.toEqual({ status: 'REQUIRES_ACTION', gatewayRef: 'manual_p1' });
  });

  it('verify reports the staff decision, and PENDING while waiting', async () => {
    prisma.payment.findUnique.mockResolvedValueOnce({ status: 'CAPTURED' });
    await expect(gateway.verify('manual_p1')).resolves.toEqual({ status: 'CAPTURED' });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: 'AUTHORIZED' });
    await expect(gateway.verify('manual_p1')).resolves.toEqual({ status: 'PENDING' });
    prisma.payment.findUnique.mockResolvedValueOnce({ status: 'FAILED' });
    await expect(gateway.verify('manual_p1')).resolves.toEqual({ status: 'FAILED' });
    prisma.payment.findUnique.mockResolvedValueOnce(null);
    await expect(gateway.verify('nope')).resolves.toEqual({ status: 'FAILED' });
  });

  it('refunds are recorded for a by-hand transfer back', async () => {
    await expect(gateway.refund({ gatewayRef: 'manual_p1' } as any)).resolves.toEqual({ gatewayRef: 'manualrefund_manual_p1' });
  });
});
