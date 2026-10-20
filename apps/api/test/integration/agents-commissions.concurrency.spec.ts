import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { CommissionsService } from '../../src/modules/agents/commissions.service';
import { AgentsService } from '../../src/modules/agents/agents.service';
import { applyReferral, agentForOrder } from '../../src/modules/agents/referrals';

/**
 * Commissions on a real Postgres: the unique orderId, the order row lock and the
 * payout's conditional claim are what keep an agent from being credited or paid
 * twice, and none of that can be shown with a mocked client.
 */
describe('Agent commissions under concurrent events (real Postgres)', () => {
  let prisma: PrismaService;
  let commissions: CommissionsService;
  let agents: AgentsService;
  let staff: { notify: jest.Mock };
  let agentId: string;
  let customerId: string;
  let ownerId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    staff = { notify: jest.fn().mockResolvedValue(null) };
    commissions = new CommissionsService(prisma, staff as any);
    agents = new AgentsService(prisma, new AuditService(prisma), { get: () => 'USD' } as any, { resolve: jest.fn() } as any);
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    staff.notify.mockClear();
    await prisma.currency.create({ data: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true } });
    const owner = await prisma.user.create({ data: { phone: `+2222${Math.floor(1e7 + Math.random() * 8e7)}`, fullName: 'Owner' } });
    ownerId = owner.id;
    const agentUser = await prisma.user.create({ data: { phone: `+2223${Math.floor(1e7 + Math.random() * 8e7)}`, fullName: 'Sidi Agent' } });
    const agent = await prisma.agent.create({
      data: { userId: agentUser.id, code: `T${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, 'X')}`, commissionType: 'PERCENT', commissionValue: 10 },
    });
    agentId = agent.id;
    const customer = await prisma.user.create({
      data: { phone: `+2224${Math.floor(1e7 + Math.random() * 8e7)}`, fullName: 'Amina Customer', referredByAgentId: agentId },
    });
    customerId = customer.id;
  });

  let seq = 0;
  async function order(status: OrderStatus, totalBase = 100) {
    const o = await prisma.order.create({
      data: {
        orderNumber: `PTN-AG-${Date.now()}-${++seq}`, userId: customerId, status, agentId,
        subtotal: totalBase, total: totalBase, currency: 'USD', baseCurrency: 'USD', fxRate: 1, totalBase,
      },
    });
    return o.id;
  }

  async function refund(orderId: string, amount: number) {
    await prisma.refund.create({
      data: {
        orderId, amount, currency: 'USD', fxRate: 1, amountBase: amount, reason: 'test', status: 'PROCESSED',
        requestedById: ownerId, processedById: ownerId, processedAt: new Date(),
      },
    });
  }

  it('creates exactly one commission when the same order events arrive at the same moment', async () => {
    const orderId = await order('PAID');
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => commissions.syncOrder(orderId)));

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await prisma.commission.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'PENDING', agentId });
    expect(rows[0].amount.toString()).toBe('10');
    const created = results.filter((r) => r.status === 'fulfilled' && r.value.action === 'created');
    expect(created).toHaveLength(1);
  });

  it('ends EARNED once, whichever of paid/completed/refund events win the race', async () => {
    const orderId = await order('COMPLETED', 80);
    await refund(orderId, 20);
    await Promise.all(Array.from({ length: 6 }, () => commissions.syncOrder(orderId)));
    const rows = await prisma.commission.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('EARNED');
    // 10% of the net 60
    expect(rows[0].amount.toString()).toBe('6');
    expect(rows[0].basis.toString()).toBe('60');
  });

  it('walks the whole lifecycle: pending → earned → paid → clawback, and the next payout recovers it', async () => {
    const orderId = await order('PAID');
    expect((await commissions.syncOrder(orderId)).status).toBe('PENDING');

    await prisma.order.update({ where: { id: orderId }, data: { status: 'COMPLETED' } });
    expect((await commissions.syncOrder(orderId)).status).toBe('EARNED');

    await refund(orderId, 30); // partial, before payout: recomputed
    await commissions.syncOrder(orderId);
    let c = await prisma.commission.findUniqueOrThrow({ where: { orderId } });
    expect(c.amount.toString()).toBe('7');

    const { payout } = await agents.recordPayout(agentId, { commissionIds: [c.id] }, ownerId);
    expect(payout.amount.toString()).toBe('7');

    // refunded in full after payout: the paid row stays, a clawback shows beside it
    await refund(orderId, 70);
    await prisma.order.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });
    expect((await commissions.syncOrder(orderId)).action).toBe('clawback');
    expect((await commissions.syncOrder(orderId)).action).toBe('none'); // a repeat changes nothing
    c = await prisma.commission.findUniqueOrThrow({ where: { orderId } });
    expect(c).toMatchObject({ status: 'PAID', clawbackReason: 'order_refunded' });
    expect(c.amount.toString()).toBe('7');
    expect(c.clawbackAmount?.toString()).toBe('7');
    expect(staff.notify).toHaveBeenCalledTimes(1);

    let st = await agents.statement(agentId);
    expect(st).toMatchObject({ paid: { count: 1, amount: '7.00' }, clawback: { total: '7.00', open: '7.00' }, balanceDue: '-7.00' });

    // the next earned commission pays out net of the open clawback
    const second = await order('COMPLETED', 100);
    await commissions.syncOrder(second);
    const c2 = await prisma.commission.findUniqueOrThrow({ where: { orderId: second } });
    const { payout: p2 } = await agents.recordPayout(agentId, { commissionIds: [c2.id], reference: 'TRX-1' }, ownerId);
    expect(p2.amount.toString()).toBe('3');
    expect(p2.clawbackDeducted?.toString()).toBe('7');
    st = await agents.statement(agentId);
    expect(st).toMatchObject({ clawback: { open: '0.00', recovered: '7.00' }, balanceDue: '0.00', payouts: { count: 2, total: '10.00' } });
  });

  it('pays a set of commissions once, however many payouts race for them', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await order('COMPLETED', 50);
      await commissions.syncOrder(o);
      ids.push((await prisma.commission.findUniqueOrThrow({ where: { orderId: o } })).id);
    }

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => agents.recordPayout(agentId, { commissionIds: ids }, ownerId)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictException);
    }
    expect(await prisma.agentPayout.count({ where: { agentId } })).toBe(1);
    const paid = await prisma.commission.findMany({ where: { id: { in: ids } } });
    expect(paid.every((c) => c.status === 'PAID')).toBe(true);
    expect(new Set(paid.map((c) => c.payoutId)).size).toBe(1);
  });

  it('never leaves a commission both voided and paid when a refund races a payout', async () => {
    for (let round = 0; round < 4; round++) {
      const o = await order('COMPLETED', 40);
      await commissions.syncOrder(o);
      const c = await prisma.commission.findUniqueOrThrow({ where: { orderId: o } });
      await refund(o, 40);
      await prisma.order.update({ where: { id: o }, data: { status: 'REFUNDED' } });

      const [pay] = await Promise.allSettled([
        agents.recordPayout(agentId, { commissionIds: [c.id] }, ownerId),
        commissions.syncOrder(o),
      ]);
      // the sync may have run first; one more makes the end state independent of the order
      await commissions.syncOrder(o);
      const after = await prisma.commission.findUniqueOrThrow({ where: { id: c.id } });
      if (pay.status === 'fulfilled') {
        expect(after.status).toBe('PAID');
        expect(after.clawbackAmount?.toString()).toBe(after.amount.toString());
      } else {
        expect(after.status).toBe('VOID');
        expect(after.payoutId).toBeNull();
      }
    }
  });

  it('voids on cancel or failure, with the reason', async () => {
    const cancelled = await order('CANCELLED');
    expect((await commissions.syncOrder(cancelled)).action).toBe('none'); // nothing was ever owed
    const failed = await order('PAID');
    await commissions.syncOrder(failed);
    await prisma.order.update({ where: { id: failed }, data: { status: 'FAILED' } });
    await commissions.syncOrder(failed);
    expect(await prisma.commission.findUniqueOrThrow({ where: { orderId: failed } })).toMatchObject({ status: 'VOID', voidReason: 'order_failed' });
  });

  it('keeps the rule a commission was made with when the agent\'s rule changes later', async () => {
    const o = await order('PAID', 200);
    await commissions.syncOrder(o);
    await prisma.agent.update({ where: { id: agentId }, data: { commissionType: 'FIXED', commissionValue: 1 } });
    await prisma.order.update({ where: { id: o }, data: { status: 'COMPLETED' } });
    await commissions.syncOrder(o);
    const c = await prisma.commission.findUniqueOrThrow({ where: { orderId: o } });
    expect(c.amount.toString()).toBe('20');
    expect(c.rule).toEqual({ type: 'PERCENT', value: '10' });
  });

  describe('referral capture', () => {
    it('stores the referrer once, for an active agent that is not the customer', async () => {
      const agent = await prisma.agent.findUniqueOrThrow({ where: { id: agentId } });
      const fresh = await prisma.user.create({ data: { phone: `+2225${Math.floor(1e7 + Math.random() * 8e7)}`, fullName: 'New One' } });

      expect(await prisma.$transaction((tx) => applyReferral(tx, fresh.id, agent.code.toLowerCase()))).toBe(agentId);
      // a second code never replaces the first referrer
      const other = await prisma.agent.create({ data: { userId: ownerId, code: 'OTHER9', commissionType: 'FIXED', commissionValue: 2 } });
      expect(await prisma.$transaction((tx) => applyReferral(tx, fresh.id, other.code))).toBeNull();
      expect((await prisma.user.findUniqueOrThrow({ where: { id: fresh.id } })).referredByAgentId).toBe(agentId);

      // own code, inactive agent, unknown or malformed code: ignored
      expect(await prisma.$transaction((tx) => applyReferral(tx, ownerId, 'OTHER9'))).toBeNull();
      await prisma.agent.update({ where: { id: other.id }, data: { isActive: false } });
      const another = await prisma.user.create({ data: { phone: `+2226${Math.floor(1e7 + Math.random() * 8e7)}`, fullName: 'Another' } });
      expect(await prisma.$transaction((tx) => applyReferral(tx, another.id, 'OTHER9'))).toBeNull();
      expect(await prisma.$transaction((tx) => applyReferral(tx, another.id, 'NOPE00'))).toBeNull();
      expect(await prisma.$transaction((tx) => applyReferral(tx, another.id, "x'; drop"))).toBeNull();
    });

    it('credits orders only while the referrer is active', async () => {
      expect(await prisma.$transaction((tx) => agentForOrder(tx, customerId))).toBe(agentId);
      await prisma.agent.update({ where: { id: agentId }, data: { isActive: false } });
      expect(await prisma.$transaction((tx) => agentForOrder(tx, customerId))).toBeNull();
    });
  });
});
