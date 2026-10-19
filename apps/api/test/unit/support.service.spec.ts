import { NotFoundException } from '@nestjs/common';
import { MAX_OPEN_TICKETS, SupportService } from '../../src/modules/support/support.service';
import { SupportAdminController, SupportController } from '../../src/modules/support/support.controller';

const ORDER = '66666666-6666-4666-8666-666666666666';

describe('SupportService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let notifications: any;
  let service: SupportService;

  const ticket = {
    id: 't1', userId: 'u1', orderId: ORDER, subject: 'لم يصلني الكود', message: 'دفعت ولم يصل', status: 'OPEN',
    reply: null, repliedAt: null,
  };

  beforeEach(() => {
    tx = {
      supportTicket: {
        findUnique: jest.fn().mockResolvedValue(ticket),
        update: jest.fn((a: any) => Promise.resolve({ ...ticket, ...a.data })),
      },
    };
    prisma = {
      order: { findFirst: jest.fn().mockResolvedValue({ id: ORDER }) },
      supportTicket: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn((a: any) => Promise.resolve({ id: 't1', ...a.data, status: 'OPEN', order: { orderNumber: 'PTN-1' } })),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    notifications = { notify: jest.fn().mockResolvedValue({ id: 'n1' }) };
    service = new SupportService(prisma, audit, notifications);
  });

  describe('customer', () => {
    it('opens a request about one of the caller\'s orders', async () => {
      const res = await service.create('u1', { orderId: ORDER, subject: 'مشكلة', message: 'لم يصل الكود' });
      expect(prisma.order.findFirst.mock.calls[0][0].where).toEqual({ id: ORDER, userId: 'u1' });
      expect(prisma.supportTicket.create.mock.calls[0][0].data).toEqual({
        userId: 'u1', orderId: ORDER, subject: 'مشكلة', message: 'لم يصل الكود',
      });
      expect(res).toMatchObject({ id: 't1', orderId: ORDER, orderNumber: 'PTN-1' });
      expect(res).not.toHaveProperty('order');
    });

    it('opens a request without an order', async () => {
      prisma.supportTicket.create.mockImplementationOnce((a: any) => Promise.resolve({ id: 't2', ...a.data, order: null }));
      const res = await service.create('u1', { subject: 'سؤال', message: 'كيف أدفع؟' });
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
      expect(res).toMatchObject({ orderId: null, orderNumber: null });
    });

    it('refuses someone else\'s order and too many open requests', async () => {
      prisma.order.findFirst.mockResolvedValueOnce(null);
      await expect(service.create('u1', { orderId: ORDER, subject: 'abc', message: 'hello' })).rejects.toThrow(NotFoundException);

      prisma.supportTicket.count.mockResolvedValue(MAX_OPEN_TICKETS);
      await expect(service.create('u1', { subject: 'abc', message: 'hello' }))
        .rejects.toMatchObject({ response: expect.objectContaining({ error: 'TOO_MANY_OPEN' }) });
    });

    it('lists the caller\'s requests with their order number', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([{ id: 't1', orderId: ORDER, order: { orderNumber: 'PTN-1' } }]);
      await expect(service.listMine('u1')).resolves.toEqual([{ id: 't1', orderId: ORDER, orderNumber: 'PTN-1' }]);
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    });
  });

  describe('owner', () => {
    it('lists requests with customer and order, optionally by status', async () => {
      prisma.supportTicket.findMany.mockResolvedValue([{ id: 't1', user: { id: 'u1', fullName: 'Ali', phone: '+222' }, order: null }]);
      await expect(service.listAdmin('OPEN')).resolves.toEqual([
        { id: 't1', customer: { id: 'u1', fullName: 'Ali', phone: '+222' }, order: null },
      ]);
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where).toEqual({ status: 'OPEN' });
      await service.listAdmin();
      expect(prisma.supportTicket.findMany.mock.calls[1][0].where).toEqual({});
    });

    it('a reply marks the request answered, audits it and rings the customer', async () => {
      const res = await service.update('t1', { reply: 'أرسلنا الكود من جديد' }, 'admin');

      expect(res).toMatchObject({ status: 'ANSWERED', reply: 'أرسلنا الكود من جديد', repliedAt: expect.any(Date) });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'support.update', entityId: 't1' }));
      const [msg, usedTx] = notifications.notify.mock.calls[0];
      expect(usedTx).toBe(tx);
      expect(msg).toMatchObject({
        userId: 'u1', type: 'support.reply', orderId: ORDER, link: '/support', extra: { ticketId: 't1' },
      });
      expect(msg.ar.body).toContain('أرسلنا الكود من جديد');
      expect(msg.fr.title).toBe('Réponse à votre demande');
    });

    it('can reply and close at once, and shortens a long reply in the bell', async () => {
      tx.supportTicket.findUnique.mockResolvedValue({ ...ticket, orderId: null });
      await service.update('t1', { reply: 'x'.repeat(300), status: 'CLOSED' }, 'admin');
      expect(tx.supportTicket.update.mock.calls[0][0].data.status).toBe('CLOSED');
      const [msg] = notifications.notify.mock.calls[0];
      expect(msg.orderId).toBeUndefined();
      expect(msg.en.body.length).toBeLessThan(200);
      expect(msg.en.body.endsWith('…')).toBe(true);
    });

    it('changes the status alone without a notification', async () => {
      await service.update('t1', { status: 'CLOSED' }, 'admin');
      expect(tx.supportTicket.update.mock.calls[0][0].data).toEqual({ status: 'CLOSED' });
      await service.update('t1', {}, 'admin');
      expect(tx.supportTicket.update.mock.calls[1][0].data).toEqual({ status: 'OPEN' });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('refuses a missing request', async () => {
      tx.supportTicket.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { status: 'CLOSED' }, 'admin')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('Support controllers', () => {
  it('route to the service', async () => {
    const support: any = {
      create: jest.fn().mockResolvedValue({ id: 't1' }),
      listMine: jest.fn().mockResolvedValue([]),
      listAdmin: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: 't1' }),
    };
    const customer = new SupportController(support);
    await customer.create('u1', { subject: 'abc', message: 'hello' });
    expect(support.create).toHaveBeenCalledWith('u1', { subject: 'abc', message: 'hello' });
    await customer.mine('u1');
    expect(support.listMine).toHaveBeenCalledWith('u1');

    const admin = new SupportAdminController(support);
    await admin.list({ status: 'ANSWERED' });
    expect(support.listAdmin).toHaveBeenCalledWith('ANSWERED');
    await admin.update('t1', { reply: 'ok' }, 'admin');
    expect(support.update).toHaveBeenCalledWith('t1', { reply: 'ok' }, 'admin');
  });
});
