import { RefundStatus } from '@prisma/client';
import { RefundsController } from '../../src/modules/refunds/refunds.controller';

describe('RefundsController', () => {
  let refunds: any;
  let controller: RefundsController;

  beforeEach(() => {
    refunds = {
      findAll: jest.fn().mockResolvedValue([]),
      request: jest.fn().mockResolvedValue({ id: 'ref1' }),
      process: jest.fn().mockResolvedValue({ id: 'ref1', status: 'PROCESSED' }),
      reject: jest.fn().mockResolvedValue({ id: 'ref1', status: 'REJECTED' }),
    };
    controller = new RefundsController(refunds);
  });

  it('lists refunds filtered by status', async () => {
    await controller.findAll(RefundStatus.REQUESTED);
    expect(refunds.findAll).toHaveBeenCalledWith(RefundStatus.REQUESTED);
  });

  it('requests a refund, defaulting toWallet to false when omitted', async () => {
    const dto = { orderId: 'ord1', amount: 30, reason: 'defective' } as any;
    await controller.request(dto, 'admin');
    expect(refunds.request).toHaveBeenCalledWith('ord1', 30, 'defective', 'admin', false);
  });

  it('forwards toWallet when supplied', async () => {
    const dto = { orderId: 'ord1', amount: 30, reason: 'defective', toWallet: true } as any;
    await controller.request(dto, 'admin');
    expect(refunds.request).toHaveBeenCalledWith('ord1', 30, 'defective', 'admin', true);
  });

  it('processes a refund by id with the acting admin', async () => {
    await controller.process('ref1', 'admin');
    expect(refunds.process).toHaveBeenCalledWith('ref1', 'admin');
  });

  it('rejects a refund with a reason', async () => {
    // controller signature is reject(id, reason, actorId)
    await controller.reject('ref1', 'not eligible', 'admin');
    expect(refunds.reject).toHaveBeenCalledWith('ref1', 'admin', 'not eligible');
  });
});
