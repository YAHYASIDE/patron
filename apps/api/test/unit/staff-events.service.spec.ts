import { StaffEventsService, errorFingerprint } from '../../src/modules/staff-notifications/staff-events.service';

const ORDER = { id: 'o1', orderNumber: 'PTN-1001', status: 'PAID', total: { toString: () => '1500' }, currency: 'MRU' };

describe('StaffEventsService', () => {
  let prisma: any;
  let staff: any;
  let events: StaffEventsService;

  beforeEach(() => {
    prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(ORDER) },
      staffNotification: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    staff = {
      notify: jest.fn().mockResolvedValue({ id: 'n1' }),
      resolve: jest.fn().mockResolvedValue(undefined),
      resolveFor: jest.fn().mockResolvedValue(1),
    };
    events = new StaffEventsService(prisma, staff);
  });

  describe('outbox events', () => {
    it('order.paid: closes the transfer notice and raises "to deliver" for the order', async () => {
      await events.onOutboxEvent('order.paid', { orderId: 'o1', paymentId: 'p1' });
      expect(staff.resolve).toHaveBeenCalledWith('payment.pending:p1');
      expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'order.new', priority: 'NORMAL', link: '/orders/o1', dedupeKey: 'order.new:o1', entityType: 'Order', entityId: 'o1',
      }));
      expect(staff.notify.mock.calls[0][0].title).toContain('PTN-1001');
    });

    it('a replayed order.paid for an order already delivered raises nothing', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'COMPLETED' });
      await events.onOutboxEvent('order.paid', { orderId: 'o1' });
      expect(staff.notify).not.toHaveBeenCalled();
    });

    it('order.failed: URGENT, and it replaces "to deliver"', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'FAILED' });
      await events.onOutboxEvent('order.failed', { orderId: 'o1' });
      expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'order.failed', priority: 'URGENT', dedupeKey: 'order.failed:o1' }));
      expect(staff.resolve).toHaveBeenCalledWith('order.new:o1');
    });

    it('a partial delivery is a failure notice too', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'PARTIALLY_COMPLETED' });
      await events.onOutboxEvent('order.partially_completed', { orderId: 'o1' });
      expect(staff.notify.mock.calls[0][0].title).toContain('جزء');
    });

    it('a stale order.failed (order already retried) raises nothing', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'COMPLETED' });
      await events.onOutboxEvent('order.failed', { orderId: 'o1' });
      expect(staff.notify).not.toHaveBeenCalled();
    });

    it.each(['order.completed', 'order.cancelled', 'order.refunded'])('%s closes the order\'s notices', async (type) => {
      await events.onOutboxEvent(type, { orderId: 'o1' });
      expect(staff.resolveFor).toHaveBeenCalledWith('Order', 'o1', ['order.new', 'order.failed', 'payment.pending']);
    });

    it('refund.processed closes the refund notice, and the order\'s once fully refunded', async () => {
      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'COMPLETED' });
      await events.onOutboxEvent('refund.processed', { orderId: 'o1', refundId: 'r1' });
      expect(staff.resolve).toHaveBeenCalledWith('refund.pending:r1');
      expect(staff.resolveFor).not.toHaveBeenCalled();

      prisma.order.findUnique.mockResolvedValueOnce({ ...ORDER, status: 'REFUNDED' });
      await events.onOutboxEvent('refund.processed', { orderId: 'o1', refundId: 'r2' });
      expect(staff.resolveFor).toHaveBeenCalledWith('Order', 'o1', expect.any(Array));
    });

    it('ignores other events and events without ids, and never throws', async () => {
      await events.onOutboxEvent('order.created', { orderId: 'o1' });
      await events.onOutboxEvent('order.paid', {});
      await events.onOutboxEvent('order.failed', {});
      await events.onOutboxEvent('order.completed', {});
      await events.onOutboxEvent('refund.processed', {});
      expect(staff.notify).not.toHaveBeenCalled();
      expect(staff.resolveFor).not.toHaveBeenCalled();

      prisma.order.findUnique.mockRejectedValueOnce(new Error('db down'));
      await expect(events.onOutboxEvent('order.paid', { orderId: 'o1' })).resolves.toBeUndefined();
    });
  });

  describe('direct producers', () => {
    it('a reported transfer is HIGH, one per payment, linked to the order', async () => {
      await events.transferReported({ paymentId: 'p1', orderId: 'o1', orderNumber: 'PTN-1', amount: '1500', currency: 'MRU', method: 'Bankily' });
      expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'payment.pending', priority: 'HIGH', dedupeKey: 'payment.pending:p1', link: '/orders/o1', entityType: 'Order', entityId: 'o1',
      }));
      expect(staff.notify.mock.calls[0][0].body).toContain('Bankily');
      await events.transferReviewed('p1');
      expect(staff.resolve).toHaveBeenCalledWith('payment.pending:p1');
    });

    it('a requested refund waits as refund.pending until processed or rejected', async () => {
      await events.refundRequested({ refundId: 'r1', orderId: 'o1', orderNumber: 'PTN-1', amount: '10', currency: 'USD' });
      expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'refund.pending', dedupeKey: 'refund.pending:r1', link: '/orders/o1' }));
      await events.refundClosed('r1');
      expect(staff.resolve).toHaveBeenCalledWith('refund.pending:r1');
    });

    it('a support message, about an order or not', async () => {
      await events.supportMessage({ ticketId: 't1', subject: 'لم يصل الكود', orderNumber: 'PTN-9' });
      await events.supportMessage({ ticketId: 't2', subject: 'سؤال' });
      expect(staff.notify.mock.calls[0][0]).toMatchObject({ type: 'support.message', dedupeKey: 'support.message:t1', link: '/support' });
      expect(staff.notify.mock.calls[0][0].title).toContain('PTN-9');
      expect(staff.notify.mock.calls[1][0].title).toBe('طلب مساعدة جديد');
      await events.supportHandled('t1');
      expect(staff.resolve).toHaveBeenCalledWith('support.message:t1');
    });

    it('producers never throw', async () => {
      staff.notify.mockRejectedValue(new Error('x'));
      staff.resolve.mockRejectedValue(new Error('x'));
      await expect(events.transferReported({ paymentId: 'p', orderId: 'o', orderNumber: 'n', amount: '1', currency: 'MRU' })).resolves.toBeUndefined();
      await expect(events.transferReviewed('p')).resolves.toBeUndefined();
      await expect(events.refundRequested({ refundId: 'r', orderId: 'o', orderNumber: 'n', amount: '1', currency: 'MRU' })).resolves.toBeUndefined();
      await expect(events.refundClosed('r')).resolves.toBeUndefined();
      await expect(events.supportMessage({ ticketId: 't', subject: 's' })).resolves.toBeUndefined();
      await expect(events.supportHandled('t')).resolves.toBeUndefined();
      await expect(events.serverError({ message: 'm', method: 'GET', path: '/x', status: 500 })).resolves.toBeUndefined();
    });
  });

  describe('server errors', () => {
    const err = (message: string, path = '/api/v1/orders/11111111-1111-4111-8111-111111111111') => ({ message, method: 'GET', path, status: 500 });

    it('the same failure on two different orders is one notice', () => {
      const a = errorFingerprint('Order 11111111-1111-4111-8111-111111111111 not loaded: timeout after 3000 ms', '/api/v1/orders/11111111-1111-4111-8111-111111111111');
      const b = errorFingerprint('Order 22222222-2222-4222-8222-222222222222 not loaded: timeout after 5000 ms', '/api/v1/orders/22222222-2222-4222-8222-222222222222?x=1');
      expect(a).toBe(b);
      expect(errorFingerprint('Something else', '/api/v1/orders')).not.toBe(a);
    });

    it('raises one NORMAL notice per fingerprint, linking to the errors page', async () => {
      await events.serverError(err('Cannot read properties of undefined (reading "id")'));
      const n = staff.notify.mock.calls[0][0];
      expect(n).toMatchObject({ type: 'system.error', priority: 'NORMAL', link: '/errors', data: { count: 1 } });
      expect(n.dedupeKey).toMatch(/^system\.error:[0-9a-f]{24}$/);
    });

    it('a repeat while the notice is open only counts up, without ringing again', async () => {
      prisma.staffNotification.findFirst.mockResolvedValueOnce({ id: 'n1', data: { count: 4 } });
      await events.serverError(err('boom'));
      expect(staff.notify).not.toHaveBeenCalled();
      expect(prisma.staffNotification.update.mock.calls[0][0]).toMatchObject({ where: { id: 'n1' }, data: { data: { count: 5 } } });

      prisma.staffNotification.findFirst.mockResolvedValueOnce({ id: 'n1', data: null });
      await events.serverError(err('boom'));
      expect(prisma.staffNotification.update.mock.calls[1][0].data.data.count).toBe(2);
    });

    it('a payment taken twice is URGENT and never folded with another one', async () => {
      await events.serverError(err('Duplicate payment p-1 for order PTN-1: refund it to the customer', '/orders/o1'));
      await events.serverError(err('Duplicate payment p-2 for order PTN-2: refund it to the customer', '/orders/o2'));
      const [a, b] = staff.notify.mock.calls.map((c: any[]) => c[0]);
      expect(a).toMatchObject({ priority: 'URGENT', link: '/orders/o1' });
      expect(a.dedupeKey).not.toBe(b.dedupeKey);
    });
  });
});
