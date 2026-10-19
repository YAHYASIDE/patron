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
    await controller.findAll({ status: RefundStatus.REQUESTED });
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
    await controller.reject('ref1', { reason: 'not eligible' }, 'admin');
    expect(refunds.reject).toHaveBeenCalledWith('ref1', 'admin', 'not eligible');
  });

  it('validates the reject body and the status filter instead of trusting raw fields', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { RejectRefundDto, RefundsQueryDto } = await import('../../src/modules/payments/dto/payment.dto');
    const errs = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).map((e) => e.property);
    expect(await errs(RejectRefundDto, { reason: ['a', 'b', 'c'] })).toEqual(['reason']);
    expect(await errs(RejectRefundDto, { reason: 'not eligible' })).toEqual([]);
    expect(await errs(RefundsQueryDto, { status: ['REQUESTED'] })).toEqual(['status']);
    expect(await errs(RefundsQueryDto, {})).toEqual([]);
  });
});
