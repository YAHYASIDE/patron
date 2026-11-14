import { Prisma } from '@prisma/client';

import { allocateClawbacks, buildStatement, StatusGroup } from '../../src/modules/agents/statement';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const g = (status: StatusGroup['status'], count: number, amount: number, claw?: number, rec?: number): StatusGroup => ({
  status, _count: { _all: count },
  _sum: { amount: D(amount), clawbackAmount: claw === undefined ? null : D(claw), clawbackRecovered: rec === undefined ? null : D(rec) },
});

describe('agent statement', () => {
  it('adds up each status, the payouts and the balance due', () => {
    const s = buildStatement(
      [g('PENDING', 2, 15), g('EARNED', 3, 30), g('PAID', 4, 40, 10, 4), g('VOID', 1, 5)],
      { count: 2, total: D(36) },
      'USD',
    );
    expect(s).toEqual({
      currency: 'USD',
      pending: { count: 2, amount: '15.00' },
      earned: { count: 3, amount: '30.00' },
      paid: { count: 4, amount: '40.00' },
      void: { count: 1, amount: '5.00' },
      clawback: { total: '10.00', recovered: '4.00', open: '6.00' },
      payouts: { count: 2, total: '36.00' },
      // earned 30 less the 6 still owed back
      balanceDue: '24.00',
    });
  });

  it('is all zeros for a new agent, and can go negative when the agent owes', () => {
    expect(buildStatement([], { count: 0, total: null }, 'USD')).toMatchObject({
      earned: { count: 0, amount: '0.00' }, clawback: { open: '0.00' }, balanceDue: '0.00',
    });
    expect(buildStatement([g('PAID', 1, 7, 7)], { count: 1, total: D(7) }, 'USD').balanceDue).toBe('-7.00');
  });

  describe('allocateClawbacks', () => {
    it('takes open clawbacks oldest first, never more than the payout', () => {
      const r = allocateClawbacks(D(10), [
        { id: 'a', clawbackAmount: D(4), clawbackRecovered: D(1) },
        { id: 'b', clawbackAmount: D(2), clawbackRecovered: D(2) },
        { id: 'c', clawbackAmount: D(9), clawbackRecovered: null },
        { id: 'd', clawbackAmount: D(5), clawbackRecovered: null },
      ]);
      expect(r.deducted.toString()).toBe('10');
      expect(r.recoveries.map((x) => [x.id, x.recovered.toString()])).toEqual([['a', '4'], ['c', '7']]);
    });

    it('deducts nothing when nothing is open', () => {
      const r = allocateClawbacks(D(10), []);
      expect(r.deducted.toString()).toBe('0');
      expect(r.recoveries).toEqual([]);
    });
  });
});
