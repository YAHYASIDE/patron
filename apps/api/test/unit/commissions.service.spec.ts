import { Prisma } from '@prisma/client';

import { CommissionsService, COMMISSION_EVENTS } from '../../src/modules/agents/commissions.service';
import { CommissionsProcessor, SYNC_COMMISSION_JOB } from '../../src/modules/agents/commissions.processor';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('CommissionsService (unit)', () => {
  let tx: any;
  let prisma: any;
  let staff: any;
  let service: CommissionsService;

  const order = (over: Record<string, unknown> = {}) => ({
    id: 'o1', orderNumber: 'PTN-1', status: 'PAID', totalBase: D(100), baseCurrency: 'USD', agentId: 'ag1',
    agent: { commissionType: 'PERCENT', commissionValue: D(10) }, ...over,
  });
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1', orderId: 'o1', agentId: 'ag1', status: 'PENDING', amount: D(10), basis: D(100), currency: 'USD',
    voidReason: null, clawbackAmount: null, earnedAt: null, voidedAt: null, rule: { type: 'PERCENT', value: '10' }, ...over,
  });

  beforeEach(() => {
    tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $queryRaw: jest.fn().mockResolvedValue([]),
      order: { findUnique: jest.fn().mockResolvedValue(order()) },
      refund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountBase: null } }) },
      commission: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue(row()),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn((a: any) => Promise.resolve(row({ status: 'PAID', ...a.data }))),
      },
    };
    prisma = {
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      order: { findMany: jest.fn().mockResolvedValue([]) },
    };
    staff = { notify: jest.fn().mockResolvedValue(null) };
    service = new CommissionsService(prisma, staff);
  });

  it('does nothing for an order no agent brought', async () => {
    tx.order.findUnique.mockResolvedValue(order({ agentId: null, agent: null }));
    expect(await service.syncOrder('o1')).toEqual({ action: 'none' });
    expect(tx.commission.createMany).not.toHaveBeenCalled();
  });

  it('locks the order, then the commission, before reading either', async () => {
    await service.syncOrder('o1');
    expect(tx.$queryRawUnsafe.mock.calls[0][0]).toMatch(/FROM "orders" .*FOR UPDATE/);
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('creates the commission once (ON CONFLICT DO NOTHING) with the agent\'s rule frozen on it', async () => {
    expect(await service.syncOrder('o1')).toEqual({ action: 'created', commissionId: 'c1', status: 'PENDING' });
    const args = tx.commission.createMany.mock.calls[0][0];
    expect(args.skipDuplicates).toBe(true);
    expect(args.data[0]).toMatchObject({ agentId: 'ag1', orderId: 'o1', status: 'PENDING', currency: 'USD', rule: { type: 'PERCENT', value: '10' } });
    expect(args.data[0].amount.toString()).toBe('10');
  });

  it('earns on completion, net of processed refunds, keeping the frozen rule', async () => {
    tx.order.findUnique.mockResolvedValue(order({ status: 'COMPLETED', agent: { commissionType: 'FIXED', commissionValue: D(1) } }));
    tx.refund.aggregate.mockResolvedValue({ _sum: { amountBase: D(25) } });
    tx.commission.findUnique.mockResolvedValue(row());
    expect(await service.syncOrder('o1')).toEqual({ action: 'updated', commissionId: 'c1', status: 'EARNED' });
    const { where, data } = tx.commission.updateMany.mock.calls[0][0];
    expect(where).toEqual({ orderId: 'o1', status: { not: 'PAID' } });
    expect(data).toMatchObject({ status: 'EARNED', voidReason: null, voidedAt: null });
    expect(data.amount.toString()).toBe('7.5');
    expect(data.earnedAt).toBeInstanceOf(Date);
  });

  it('voids with a reason and keeps when it was earned', async () => {
    const earnedAt = new Date('2026-10-01');
    tx.order.findUnique.mockResolvedValue(order({ status: 'CANCELLED' }));
    tx.commission.findUnique.mockResolvedValue(row({ status: 'EARNED', earnedAt }));
    await service.syncOrder('o1');
    expect(tx.commission.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'VOID', voidReason: 'order_cancelled', earnedAt });
  });

  it('refuses to overwrite a commission that was paid meanwhile (the job retries)', async () => {
    tx.order.findUnique.mockResolvedValue(order({ status: 'REFUNDED' }));
    tx.commission.findUnique.mockResolvedValue(row({ status: 'EARNED' }));
    tx.commission.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.syncOrder('o1')).rejects.toThrow(/paid meanwhile/);
  });

  it('records a clawback beside a paid commission and tells the owner, once per change', async () => {
    tx.order.findUnique.mockResolvedValue(order({ status: 'REFUNDED' }));
    tx.commission.findUnique.mockResolvedValue(row({ status: 'PAID' }));
    expect(await service.syncOrder('o1')).toEqual({ action: 'clawback', commissionId: 'c1', status: 'PAID' });
    expect(tx.commission.update.mock.calls[0][0].data).toMatchObject({ clawbackReason: 'order_refunded' });
    expect(tx.commission.update.mock.calls[0][0].data.clawbackAmount.toString()).toBe('10');
    expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent.clawback', dedupeKey: 'agent.clawback:c1', link: '/agents/ag1', priority: 'HIGH',
    }));
  });

  it('is a noop on a repeated event', async () => {
    tx.commission.findUnique.mockResolvedValue(row());
    expect(await service.syncOrder('o1')).toEqual({ action: 'none', commissionId: 'c1', status: 'PENDING' });
    expect(tx.commission.updateMany).not.toHaveBeenCalled();
    expect(staff.notify).not.toHaveBeenCalled();
  });

  it('recomputes every non-pending order of an agent and counts what changed', async () => {
    prisma.order.findMany.mockResolvedValue([{ id: 'o1' }, { id: 'o2' }]);
    tx.commission.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    expect(await service.syncAgent('ag1')).toEqual({ orders: 2, created: 1, updated: 0, clawback: 0 });
    expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({ agentId: 'ag1', status: { not: 'PENDING_PAYMENT' } });
  });

  it('listens to every event that can move an order\'s commission', () => {
    for (const e of ['order.paid', 'order.completed', 'order.cancelled', 'order.failed', 'refund.processed']) {
      expect(COMMISSION_EVENTS.has(e)).toBe(true);
    }
    expect(COMMISSION_EVENTS.has('order.created')).toBe(false);
  });

  describe('processor', () => {
    it('syncs the order named by the job and rejects unknown jobs', async () => {
      const commissions = { syncOrder: jest.fn().mockResolvedValue({ action: 'none' }) };
      const p = new CommissionsProcessor(commissions as any);
      await p.process({ name: SYNC_COMMISSION_JOB, data: { orderId: 'o9', eventType: 'order.paid' } } as any);
      expect(commissions.syncOrder).toHaveBeenCalledWith('o9');
      expect(() => p.process({ name: 'other', data: {} } as any)).toThrow(/Unknown agents job/);
    });
  });
});
