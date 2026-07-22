import {
  CheckoutController, OrdersController, OrdersAdminController,
} from '../../src/modules/orders/orders.controller';

describe('Orders controllers', () => {
  let quotes: any;
  let orders: any;

  beforeEach(() => {
    quotes = {
      create: jest.fn().mockResolvedValue({ id: 'q1' }),
      findOne: jest.fn().mockResolvedValue({ id: 'q1' }),
    };
    orders = {
      createFromQuote: jest.fn().mockResolvedValue({ id: 'o1' }),
      findAllForUser: jest.fn().mockResolvedValue({ data: [] }),
      findAllAdmin: jest.fn().mockResolvedValue({ data: [] }),
      findOne: jest.fn().mockResolvedValue({ id: 'o1' }),
      revealResult: jest.fn().mockResolvedValue([{ value: 'x' }]),
      cancelUnpaid: jest.fn().mockResolvedValue({ id: 'o1' }),
    };
  });

  describe('CheckoutController', () => {
    let controller: CheckoutController;
    beforeEach(() => { controller = new CheckoutController(quotes, orders); });

    it('createQuote delegates with user, dto and ip', async () => {
      const dto: any = { items: [] };
      await controller.createQuote('u1', dto, '1.2.3.4');
      expect(quotes.create).toHaveBeenCalledWith('u1', dto, '1.2.3.4');
    });

    it('getQuote delegates with id and user', async () => {
      await controller.getQuote('u1', 'q1');
      expect(quotes.findOne).toHaveBeenCalledWith('q1', 'u1');
    });

    it('createOrder passes the quoteId with ip and user-agent metadata', async () => {
      const req: any = { headers: { 'user-agent': 'jest-agent' } };
      await controller.createOrder('u1', { quoteId: 'q1' } as any, req, '9.9.9.9');
      expect(orders.createFromQuote).toHaveBeenCalledWith('u1', 'q1', {
        ip: '9.9.9.9', userAgent: 'jest-agent',
      });
    });
  });

  describe('OrdersController', () => {
    let controller: OrdersController;
    beforeEach(() => { controller = new OrdersController(orders); });

    it('findMine delegates to findAllForUser', async () => {
      const query: any = { limit: 20 };
      await controller.findMine('u1', query);
      expect(orders.findAllForUser).toHaveBeenCalledWith('u1', query);
    });

    it('findOne delegates with id and user (ownership enforced downstream)', async () => {
      await controller.findOne('u1', 'o1');
      expect(orders.findOne).toHaveBeenCalledWith('o1', 'u1');
    });

    it('reveal delegates itemId and user', async () => {
      await controller.reveal('u1', 'item1');
      expect(orders.revealResult).toHaveBeenCalledWith('item1', 'u1');
    });
  });

  describe('OrdersAdminController', () => {
    let controller: OrdersAdminController;
    beforeEach(() => { controller = new OrdersAdminController(orders); });

    it('findAll delegates to findAllAdmin', async () => {
      const query: any = { limit: 20 };
      await controller.findAll(query);
      expect(orders.findAllAdmin).toHaveBeenCalledWith(query);
    });

    it('findOne delegates without a user id (admin sees any order)', async () => {
      await controller.findOne('o1');
      expect(orders.findOne).toHaveBeenCalledWith('o1');
    });

    it('cancel passes the supplied reason and actor', async () => {
      await controller.cancel('o1', 'chargeback', 'admin1');
      expect(orders.cancelUnpaid).toHaveBeenCalledWith('o1', 'chargeback', 'admin1');
    });

    it('cancel falls back to a default reason when none is given', async () => {
      await controller.cancel('o1', undefined as any, 'admin1');
      expect(orders.cancelUnpaid).toHaveBeenCalledWith('o1', 'Cancelled by staff', 'admin1');
    });
  });
});
