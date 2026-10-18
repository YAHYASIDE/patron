import { ManualTransferGateway } from '../../src/modules/payments/gateways/manual.gateway';

describe('ManualTransferGateway', () => {
  let prisma: any;
  let gateway: ManualTransferGateway;

  beforeEach(() => {
    prisma = { systemSetting: { findUnique: jest.fn() }, payment: { findUnique: jest.fn() } };
    gateway = new ManualTransferGateway(prisma);
  });

  it('is offered only once the owner configured at least one account', async () => {
    prisma.systemSetting.findUnique.mockResolvedValueOnce(null);
    await expect(gateway.isEnabled()).resolves.toBe(false);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [] });
    await expect(gateway.isEnabled()).resolves.toBe(false);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [{ id: 'a', method: 'Bankily' }] });
    await expect(gateway.isEnabled()).resolves.toBe(true);
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
