import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AgentsService, shareLink } from '../../src/modules/agents/agents.service';
import { AgentSelfService } from '../../src/modules/agents/agent-self.service';
import { AgentsAdminController, AgentSelfController } from '../../src/modules/agents/agents.controller';
import { forCustomer } from '../../src/modules/orders/orders.service';
import { agentForOrder, applyReferral } from '../../src/modules/agents/referrals';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('AgentsService (unit)', () => {
  let tx: any;
  let prisma: any;
  let audit: any;
  let staff: any;
  let service: AgentsService;

  const agentRow = {
    id: 'ag1', userId: 'u1', code: 'K7MXQ2', isActive: true, commissionType: 'PERCENT', commissionValue: D(10), note: null,
    createdAt: new Date(), user: { id: 'u1', fullName: 'Sidi', phone: '+22222123456', email: null, createdAt: new Date() },
    _count: { referrals: 2, orders: 3 },
  };

  beforeEach(() => {
    tx = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }), create: jest.fn().mockResolvedValue({ id: 'new-user' }) },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-customer' }) },
      agent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'ag1' }),
        update: jest.fn((a: any) => Promise.resolve(a.data)),
      },
      userRole: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'ag1' }]),
      agentPayout: { create: jest.fn((a: any) => Promise.resolve({ id: 'p1', ...a.data })) },
      commission: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      agent: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      role: { findUnique: jest.fn().mockResolvedValue({ id: 'role-agent' }) },
      commission: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      agentPayout: {
        groupBy: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 0 }, _sum: { amount: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      order: { count: jest.fn().mockResolvedValue(1) },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    staff = { resolve: jest.fn().mockResolvedValue(undefined) };
    service = new AgentsService(prisma, audit, { get: () => 'USD' } as any, staff);
  });

  describe('create', () => {
    const base = { commissionType: 'PERCENT' as const, commissionValue: 10 };

    it('makes an existing account an agent with a generated code and the agent role, audited', async () => {
      prisma.agent.findUnique.mockImplementation((a: any) => Promise.resolve(a.where.id ? agentRow : null));
      const res = await service.create({ ...base, userId: 'u1' }, 'admin-1');
      const data = tx.agent.create.mock.calls[0][0].data;
      expect(data.code).toMatch(/^[A-Z2-9]{6}$/);
      expect(data.commissionValue.toString()).toBe('10');
      expect(tx.userRole.createMany).toHaveBeenCalledWith({ data: [{ userId: 'u1', roleId: 'role-agent' }], skipDuplicates: true });
      expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'agents.create', actorId: 'admin-1' });
      expect(res.statement.balanceDue).toBe('0.00');
    });

    it('refuses a percentage over 100, a taken code, a second agent row and an unknown user', async () => {
      await expect(service.create({ ...base, commissionValue: 120, userId: 'u1' }, 'a')).rejects.toThrow(BadRequestException);
      prisma.agent.findUnique.mockResolvedValueOnce({ id: 'other' });
      await expect(service.create({ ...base, userId: 'u1', code: 'TAKEN1' }, 'a')).rejects.toThrow(ConflictException);
      tx.agent.findUnique.mockResolvedValueOnce({ id: 'ag0' });
      await expect(service.create({ ...base, userId: 'u1' }, 'a')).rejects.toMatchObject({ response: { error: 'AGENT_EXISTS' } });
      tx.user.findFirst.mockResolvedValueOnce(null);
      await expect(service.create({ ...base, userId: 'zz' }, 'a')).rejects.toThrow(NotFoundException);
    });

    it('opens an account for a new WhatsApp number, which needs a name', async () => {
      tx.user.findFirst.mockResolvedValue(null);
      await expect(service.create({ ...base, phone: '+22233123456' }, 'a')).rejects.toMatchObject({ response: { error: 'NAME_REQUIRED' } });
      prisma.agent.findUnique.mockImplementation((a: any) => Promise.resolve(a.where.id ? agentRow : null));
      await service.create({ ...base, phone: '+22233123456', fullName: ' Mariem ', code: 'MARIEM' }, 'a');
      expect(tx.user.create.mock.calls[0][0].data).toMatchObject({ phone: '+22233123456', fullName: 'Mariem', country: 'MR' });
      expect(tx.agent.create.mock.calls[0][0].data).toMatchObject({ userId: 'new-user', code: 'MARIEM' });
    });

    it('fails clearly when the agent role is missing', async () => {
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(service.create({ ...base, userId: 'u1' }, 'a')).rejects.toMatchObject({ response: { error: 'ROLE_MISSING' } });
    });
  });

  describe('update', () => {
    it('changes the rule for future orders, deactivates, and audits before/after', async () => {
      tx.agent.findUnique.mockResolvedValue({ commissionType: 'PERCENT', commissionValue: D(10), isActive: true, note: null });
      prisma.agent.findUnique.mockResolvedValue(agentRow);
      await service.update('ag1', { commissionType: 'FIXED', commissionValue: 2, isActive: false, note: ' ok ' }, 'admin');
      expect(tx.agent.update.mock.calls[0][0].data).toMatchObject({ commissionType: 'FIXED', isActive: false, note: 'ok' });
      expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'agents.update', entityId: 'ag1' });
    });

    it('refuses a percentage over 100 and an unknown agent', async () => {
      tx.agent.findUnique.mockResolvedValueOnce({ commissionType: 'FIXED', commissionValue: D(500), isActive: true, note: null });
      await expect(service.update('ag1', { commissionType: 'PERCENT' }, 'a')).rejects.toThrow(BadRequestException);
      tx.agent.findUnique.mockResolvedValueOnce(null);
      await expect(service.update('nope', {}, 'a')).rejects.toThrow(NotFoundException);
    });
  });

  it('lists agents with their own totals', async () => {
    prisma.agent.findMany.mockResolvedValue([{ ...agentRow, _count: { referrals: 4, orders: 6 } }]);
    prisma.commission.groupBy.mockResolvedValue([
      { agentId: 'ag1', status: 'EARNED', _count: { _all: 2 }, _sum: { amount: D(12), clawbackAmount: null, clawbackRecovered: null } },
      { agentId: 'other', status: 'EARNED', _count: { _all: 9 }, _sum: { amount: D(99), clawbackAmount: null, clawbackRecovered: null } },
    ]);
    prisma.agentPayout.groupBy.mockResolvedValue([{ agentId: 'ag1', _count: { _all: 1 }, _sum: { amount: D(5) } }]);
    const [a] = await service.findAll({ search: '2222', active: 'true' });
    expect(a).toMatchObject({ referralsCount: 4, ordersCount: 6, statement: { earned: { count: 2, amount: '12.00' }, payouts: { total: '5.00' } } });
    expect(prisma.agent.findMany.mock.calls[0][0].where.isActive).toBe(true);
  });

  it('404s on an unknown agent', async () => {
    await expect(service.findOne('nope')).rejects.toThrow(NotFoundException);
  });

  describe('recordPayout', () => {
    it('404s when the agent does not exist', async () => {
      tx.$queryRaw.mockResolvedValueOnce([]);
      await expect(service.recordPayout('nope', { commissionIds: ['c1'] }, 'a')).rejects.toThrow(NotFoundException);
    });

    it('refuses when any chosen commission is not earned and unpaid', async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'ag1' }]).mockResolvedValueOnce([{ id: 'c1', amount: D(5), currency: 'USD' }]);
      await expect(service.recordPayout('ag1', { commissionIds: ['c1', 'c2'] }, 'a'))
        .rejects.toMatchObject({ response: { error: 'COMMISSION_NOT_PAYABLE' } });
      expect(tx.agentPayout.create).not.toHaveBeenCalled();
    });

    it('pays the earned total less open clawbacks, marks them PAID and audits it', async () => {
      tx.$queryRaw
        .mockResolvedValueOnce([{ id: 'ag1' }])
        .mockResolvedValueOnce([{ id: 'c1', amount: D(6), currency: 'USD' }, { id: 'c2', amount: D(4), currency: 'USD' }])
        .mockResolvedValueOnce([{ id: 'c0', clawbackAmount: D(3), clawbackRecovered: null }]);
      tx.commission.updateMany.mockResolvedValue({ count: 2 });
      const { payout } = await service.recordPayout('ag1', { commissionIds: ['c2', 'c1'], reference: ' TRX ' }, 'admin');
      expect(payout).toMatchObject({ reference: 'TRX', paidById: 'admin' });
      expect(payout.amount.toString()).toBe('7');
      expect(payout.clawbackDeducted?.toString()).toBe('3');
      expect(tx.commission.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: { in: ['c1', 'c2'] }, agentId: 'ag1', status: 'EARNED', payoutId: null },
        data: { status: 'PAID', payoutId: 'p1' },
      });
      expect(tx.commission.update).toHaveBeenCalledWith({ where: { id: 'c0' }, data: { clawbackRecovered: D(3) } });
      expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'agents.payout', entityId: 'p1' });
      // the clawback is recovered in full: its owner notice closes
      expect(staff.resolve).toHaveBeenCalledWith('agent.clawback:c0');
    });

    it('rolls back when a commission changed between the lock and the claim', async () => {
      tx.$queryRaw.mockResolvedValueOnce([{ id: 'ag1' }]).mockResolvedValueOnce([{ id: 'c1', amount: D(5), currency: 'USD' }]).mockResolvedValueOnce([]);
      tx.commission.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.recordPayout('ag1', { commissionIds: ['c1'] }, 'a')).rejects.toThrow(ConflictException);
    });
  });

  it('builds a share link only when the store address is known', () => {
    const before = process.env.STOREFRONT_URL;
    process.env.STOREFRONT_URL = 'https://store.example/';
    expect(shareLink('K7MXQ2')).toBe('https://store.example/?ref=K7MXQ2');
    delete process.env.STOREFRONT_URL;
    expect(shareLink('K7MXQ2')).toBeNull();
    if (before !== undefined) process.env.STOREFRONT_URL = before;
  });

  describe('agent self view', () => {
    let self: AgentSelfService;
    beforeEach(() => {
      self = new AgentSelfService(prisma, service);
    });

    it('answers NOT_AN_AGENT for an account without an agent row', async () => {
      await expect(self.me('u9')).rejects.toMatchObject({ response: { error: 'NOT_AN_AGENT' } });
    });

    it('shows the code, the share path, the counts and the statement', async () => {
      prisma.agent.findUnique.mockResolvedValue(agentRow);
      const me = await self.me('u1');
      expect(me).toMatchObject({ code: 'K7MXQ2', sharePath: '/?ref=K7MXQ2', counts: { referrals: 2, orders: 3, paidOrders: 1 } });
      expect(prisma.agent.findUnique.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    });

    it('lists referrals with first names and masked numbers only', async () => {
      prisma.agent.findUnique.mockResolvedValue(agentRow);
      prisma.user.findMany.mockResolvedValue([
        { id: 'secret-id', fullName: 'Amina Sy', phone: '+22244123456', createdAt: new Date(), _count: { orders: 2 } },
      ]);
      const [r] = await self.referrals('u1');
      expect(r).toEqual({ n: 1, name: 'Amina', phone: '+222 •••• 56', joinedAt: expect.any(Date), orders: 2 });
      expect(JSON.stringify(r)).not.toContain('secret-id');
      expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ referredByAgentId: 'ag1' });
    });

    it('lists only their own commissions, without the full order number or customer name', async () => {
      prisma.agent.findUnique.mockResolvedValue(agentRow);
      prisma.commission.findMany.mockResolvedValue([
        { id: 'c1', amount: D(3), status: 'EARNED', order: { orderNumber: 'PTN-20261020-000123', user: { fullName: 'Amina Sy' } } },
      ]);
      const [c] = await self.commissions('u1');
      expect(c).toMatchObject({ order: '…0123', customer: 'Amina' });
      expect(prisma.commission.findMany.mock.calls[0][0].where).toEqual({ agentId: 'ag1' });
    });
  });

  describe('controllers', () => {
    it('delegate to the services', async () => {
      const ok = () => jest.fn().mockResolvedValue({});
      const agents = { findAll: ok(), create: ok(), findOne: ok(), update: ok(), recordPayout: ok(), statement: jest.fn().mockResolvedValue({}) };
      const commissions = { syncAgent: jest.fn().mockResolvedValue({ orders: 0 }) };
      const admin = new AgentsAdminController(agents as any, commissions as any);
      await admin.findAll({});
      await admin.create({ commissionType: 'FIXED', commissionValue: 1, userId: 'u' }, 'a');
      await admin.findOne('ag1');
      await admin.update('ag1', {}, 'a');
      await admin.payout('ag1', { commissionIds: ['c'] }, 'a');
      expect(await admin.recompute('ag1')).toEqual({ orders: 0, statement: {} });
      expect(agents.recordPayout).toHaveBeenCalledWith('ag1', { commissionIds: ['c'] }, 'a');

      const selfSvc = { me: ok(), referrals: ok(), commissions: ok() };
      const mine = new AgentSelfController(selfSvc as any);
      await mine.me('u1');
      await mine.referrals('u1');
      await mine.commissions('u1');
      expect(selfSvc.commissions).toHaveBeenCalledWith('u1');
    });
  });
});

describe('customer-facing order payloads', () => {
  it('never carry the crediting agent', () => {
    expect(forCustomer({ id: 'o1', agentId: 'ag1', adminNote: 'x' })).toEqual({ id: 'o1' });
  });
});

describe('referrals', () => {
  it('does not touch the database without a usable code', async () => {
    const tx = { agent: { findUnique: jest.fn() } };
    expect(await applyReferral(tx as any, 'u1', undefined)).toBeNull();
    expect(await applyReferral(tx as any, 'u1', '<script>')).toBeNull();
    expect(tx.agent.findUnique).not.toHaveBeenCalled();
  });

  it('ignores inactive, unknown and self-owned codes, and never replaces a referrer', async () => {
    const tx = { agent: { findUnique: jest.fn() }, user: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    tx.agent.findUnique.mockResolvedValueOnce(null);
    expect(await applyReferral(tx as any, 'u1', 'NOPE00')).toBeNull();
    tx.agent.findUnique.mockResolvedValueOnce({ id: 'ag1', userId: 'u2', isActive: false });
    expect(await applyReferral(tx as any, 'u1', 'K7MXQ2')).toBeNull();
    tx.agent.findUnique.mockResolvedValueOnce({ id: 'ag1', userId: 'u1', isActive: true });
    expect(await applyReferral(tx as any, 'u1', 'K7MXQ2')).toBeNull();
    expect(tx.user.updateMany).not.toHaveBeenCalled();
    // already referred: the conditional update matches nothing
    tx.agent.findUnique.mockResolvedValueOnce({ id: 'ag1', userId: 'u2', isActive: true });
    expect(await applyReferral(tx as any, 'u1', 'K7MXQ2')).toBeNull();
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', referredByAgentId: null }, data: { referredByAgentId: 'ag1' } });
  });

  it('credits an order only to an active referrer who is not the customer', async () => {
    const tx = { user: { findUnique: jest.fn() } };
    tx.user.findUnique.mockResolvedValueOnce({ referredByAgent: { id: 'ag1', userId: 'u2', isActive: true } });
    expect(await agentForOrder(tx as any, 'u1')).toBe('ag1');
    tx.user.findUnique.mockResolvedValueOnce({ referredByAgent: null });
    expect(await agentForOrder(tx as any, 'u1')).toBeNull();
    tx.user.findUnique.mockResolvedValueOnce(null);
    expect(await agentForOrder(tx as any, 'u1')).toBeNull();
  });
});
