import { PaymentsAdminController, PaymentsController, WebhooksController } from '../../src/modules/payments/payments.controller';

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

describe('payments: transfer receipts and accounts', () => {
  it('passes a customer receipt through with the payer', async () => {
    const payments = { attachProof: jest.fn().mockResolvedValue({ proofId: 'p1' }) } as any;
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff]), size: 3 };
    await expect(new PaymentsController(payments).attachProof('u1', 'pay1', file)).resolves.toEqual({ proofId: 'p1' });
    expect(payments.attachProof).toHaveBeenCalledWith('pay1', 'u1', file);
  });

  it('shows staff the receipt without caching it', async () => {
    const payments = { proof: jest.fn().mockResolvedValue({ mime: 'image/jpeg', data: Buffer.from('x') }) } as any;
    const res = { setHeader: jest.fn(), end: jest.fn() } as any;
    await new PaymentsAdminController(payments).proof('pay1', res);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.end).toHaveBeenCalled();
  });

  it('customers get usable accounts, the dashboard gets all of them', () => {
    const payments = { manualInstructions: jest.fn().mockReturnValue('x') } as any;
    void new PaymentsController(payments).manualAccounts();
    expect(payments.manualInstructions).toHaveBeenLastCalledWith();
    void new PaymentsAdminController(payments).manualAccounts();
    expect(payments.manualInstructions).toHaveBeenLastCalledWith(true);
  });
});
