import { PaymentsController, WebhooksController } from '../../src/modules/payments/payments.controller';

describe('PaymentsController', () => {
  let payments: any;
  let controller: PaymentsController;

  beforeEach(() => {
    payments = {
      availableMethods: jest.fn().mockReturnValue(['WALLET', 'STRIPE']),
      initiate: jest.fn().mockResolvedValue({ paymentId: 'pay1', status: 'REQUIRES_ACTION' }),
      confirm: jest.fn().mockResolvedValue({ status: 'CAPTURED' }),
    };
    controller = new PaymentsController(payments);
  });

  it('lists available payment methods', () => {
    expect(controller.methods()).toEqual(['WALLET', 'STRIPE']);
  });

  it('initiates a payment with the order-derived arguments', async () => {
    const dto = { orderId: 'ord1', gateway: 'STRIPE', returnUrl: 'https://return' } as any;
    const res = await controller.initiate('usr1', dto);
    expect(payments.initiate).toHaveBeenCalledWith('ord1', 'usr1', 'STRIPE', 'https://return');
    expect(res).toEqual({ paymentId: 'pay1', status: 'REQUIRES_ACTION' });
  });

  it('confirms a payment by id', async () => {
    const res = await controller.confirm('pay1');
    expect(payments.confirm).toHaveBeenCalledWith('pay1');
    expect(res).toEqual({ status: 'CAPTURED' });
  });
});

describe('WebhooksController', () => {
  let payments: any;
  let controller: WebhooksController;

  beforeEach(() => {
    payments = { handleWebhook: jest.fn().mockResolvedValue({ processed: true }) };
    controller = new WebhooksController(payments);
  });

  it('passes the raw body through for signature verification when present', async () => {
    const req = { rawBody: Buffer.from('{"raw":true}') } as any;
    const headers = { 'stripe-signature': 'sig' };
    const body = { raw: true };

    const res = await controller.handle('stripe', req, headers, body);

    expect(payments.handleWebhook).toHaveBeenCalledWith('stripe', '{"raw":true}', headers, body);
    expect(res).toEqual({ processed: true });
  });

  it('falls back to serialising the parsed body when no raw body was captured', async () => {
    const req = {} as any;
    const body = { a: 1 };

    await controller.handle('stripe', req, {}, body);

    expect(payments.handleWebhook).toHaveBeenCalledWith('stripe', JSON.stringify(body), {}, body);
  });
});
