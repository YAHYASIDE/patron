import { Prisma } from '@prisma/client';

import {
  commissionAmount, firstName, generateCode, maskPhone, netValue, normalizeCode, plan, targetFor,
  type CommissionRule, type ExistingCommission,
} from '../../src/modules/agents/commission-rules';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const pct: CommissionRule = { type: 'PERCENT', value: '10' };
const fixed: CommissionRule = { type: 'FIXED', value: '5' };
const existing = (over: Partial<ExistingCommission>): ExistingCommission => ({
  status: 'PENDING', amount: D(10), basis: D(100), voidReason: null, clawbackAmount: null, ...over,
});

describe('commission rules', () => {
  describe('netValue', () => {
    it('subtracts processed refunds and never goes below zero', () => {
      expect(netValue(100, 30).toString()).toBe('70');
      expect(netValue(100, null).toString()).toBe('100');
      expect(netValue(100, 130).toString()).toBe('0');
    });
  });

  describe('commissionAmount', () => {
    it('takes the percent of the net value, to the cent', () => {
      expect(commissionAmount(pct, D('33.33')).toString()).toBe('3.33');
      expect(commissionAmount({ type: 'PERCENT', value: '2.5' }, D(41)).toString()).toBe('1.03');
    });

    it('pays a fixed amount per order, capped at what the order is still worth', () => {
      expect(commissionAmount(fixed, D(100)).toString()).toBe('5');
      expect(commissionAmount(fixed, D(3)).toString()).toBe('3');
    });

    it('is zero on a worthless order or a zero rule', () => {
      expect(commissionAmount(pct, D(0)).toString()).toBe('0');
      expect(commissionAmount({ type: 'FIXED', value: '0' }, D(10)).toString()).toBe('0');
    });
  });

  describe('targetFor', () => {
    it('maps every order status', () => {
      expect(targetFor('PENDING_PAYMENT', D(10))).toEqual({ status: 'NONE' });
      expect(targetFor('PAID', D(10))).toEqual({ status: 'PENDING' });
      expect(targetFor('PROCESSING', D(10))).toEqual({ status: 'PENDING' });
      expect(targetFor('PARTIALLY_COMPLETED', D(10))).toEqual({ status: 'PENDING' });
      expect(targetFor('COMPLETED', D(10))).toEqual({ status: 'EARNED' });
      expect(targetFor('CANCELLED', D(10))).toEqual({ status: 'VOID', reason: 'order_cancelled' });
      expect(targetFor('FAILED', D(10))).toEqual({ status: 'VOID', reason: 'order_failed' });
      expect(targetFor('REFUNDED', D(10))).toEqual({ status: 'VOID', reason: 'order_refunded' });
    });

    it('voids a completed order refunded down to nothing', () => {
      expect(targetFor('COMPLETED', D(0))).toEqual({ status: 'VOID', reason: 'order_refunded' });
    });
  });

  describe('plan', () => {
    it('creates a commission only for a paid or completed order', () => {
      expect(plan(null, { status: 'PENDING' }, pct, D(100))).toMatchObject({ kind: 'create', status: 'PENDING' });
      expect(plan(null, { status: 'EARNED' }, pct, D(50))).toMatchObject({ kind: 'create', status: 'EARNED' });
      expect(plan(null, { status: 'NONE' }, pct, D(50))).toEqual({ kind: 'noop' });
      expect(plan(null, { status: 'VOID', reason: 'order_failed' }, pct, D(50))).toEqual({ kind: 'noop' });
    });

    it('is a noop when nothing changed (repeated events)', () => {
      expect(plan(existing({}), { status: 'PENDING' }, pct, D(100))).toEqual({ kind: 'noop' });
      expect(plan(existing({}), { status: 'NONE' }, pct, D(100))).toEqual({ kind: 'noop' });
    });

    it('earns on completion, recomputed on the net value after a partial refund', () => {
      const p = plan(existing({}), { status: 'EARNED' }, pct, D(70));
      expect(p).toMatchObject({ kind: 'update', status: 'EARNED', voidReason: null });
      if (p.kind === 'update') expect(p.amount.toString()).toBe('7');
    });

    it('voids with the reason on cancel, failure or full refund', () => {
      expect(plan(existing({ status: 'EARNED' }), { status: 'VOID', reason: 'order_refunded' }, pct, D(0)))
        .toMatchObject({ kind: 'update', status: 'VOID', voidReason: 'order_refunded' });
    });

    it('revives a voided commission when a failed order is retried and completes', () => {
      expect(plan(existing({ status: 'VOID', voidReason: 'order_failed' }), { status: 'EARNED' }, pct, D(100)))
        .toMatchObject({ kind: 'update', status: 'EARNED', voidReason: null });
    });

    it('never rewrites a PAID commission: a later refund becomes a clawback', () => {
      const paid = existing({ status: 'PAID', amount: D(10) });
      const partial = plan(paid, { status: 'EARNED' }, pct, D(60));
      expect(partial).toMatchObject({ kind: 'clawback', reason: 'partial_refund' });
      if (partial.kind === 'clawback') expect(partial.clawbackAmount.toString()).toBe('4');

      const full = plan(paid, { status: 'VOID', reason: 'order_refunded' }, pct, D(0));
      expect(full).toMatchObject({ kind: 'clawback', reason: 'order_refunded' });
      if (full.kind === 'clawback') expect(full.clawbackAmount.toString()).toBe('10');
    });

    it('only ever grows a clawback, and repeats nothing', () => {
      const clawed = existing({ status: 'PAID', amount: D(10), clawbackAmount: D(4) });
      expect(plan(clawed, { status: 'EARNED' }, pct, D(60))).toEqual({ kind: 'noop' });
      expect(plan(clawed, { status: 'EARNED' }, pct, D(100))).toEqual({ kind: 'noop' });
      expect(plan(existing({ status: 'PAID' }), { status: 'EARNED' }, pct, D(100))).toEqual({ kind: 'noop' });
    });
  });

  describe('codes', () => {
    it('generates readable upper-case codes without look-alike characters', () => {
      for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
      expect(generateCode(8)).toHaveLength(8);
    });

    it('normalizes what a link carries and rejects anything else', () => {
      expect(normalizeCode(' k7mxq2 ')).toBe('K7MXQ2');
      expect(normalizeCode('ab')).toBeNull();
      expect(normalizeCode("x'; drop")).toBeNull();
      expect(normalizeCode(undefined)).toBeNull();
    });
  });

  describe('what an agent may see', () => {
    it('masks the number to its country code and last two digits', () => {
      expect(maskPhone('+22222123456')).toBe('+222 •••• 56');
      expect(maskPhone('22123456')).toBe('•••• 56');
      expect(maskPhone('123')).toBe('••••');
      expect(maskPhone(null)).toBeNull();
    });

    it('keeps the first name only', () => {
      expect(firstName('  Amina Sy Ba ')).toBe('Amina');
      expect(firstName(null)).toBe('');
    });
  });
});
