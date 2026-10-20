import { Prisma, UsdtOrderStatus } from '@prisma/client';
import { DEFAULT_USDT_CONFIG, canMove, computeQuote, isFinal, normalizeConfig } from '../../src/modules/usdt/usdt-rules';

const D = (v: string | number) => new Prisma.Decimal(v);

describe('computeQuote', () => {
  it('prices amount × rate plus a percent and a fixed USDT fee, in the currency’s minor unit', () => {
    const q = computeQuote({ amountUsdt: D('100'), rate: D('41.25'), feePercent: D('2.5'), feeFixedUsdt: D('1'), decimals: 2 });
    expect(q.subtotal.toString()).toBe('4125');
    // 4125 × 2.5% = 103.125, + 1 × 41.25 = 144.375 → 144.38
    expect(q.fee.toString()).toBe('144.38');
    expect(q.total.toString()).toBe('4269.38');
  });

  it('rounds to whole units for a currency without decimals, and the parts still add up', () => {
    const q = computeQuote({ amountUsdt: D('33.33'), rate: D('612.5'), feePercent: D('1.75'), feeFixedUsdt: D('0'), decimals: 0 });
    expect(q.subtotal.toString()).toBe('20415'); // 20414.8125
    expect(q.fee.toString()).toBe('357'); // 357.2625
    expect(q.total.eq(q.subtotal.plus(q.fee))).toBe(true);
  });

  it('never uses floats (0.1 + 0.2 stays exact)', () => {
    const q = computeQuote({ amountUsdt: D('0.1'), rate: D('3'), feePercent: D('0'), feeFixedUsdt: D('0.1'), decimals: 4 });
    expect(q.subtotal.toString()).toBe('0.3');
    expect(q.fee.toString()).toBe('0.3');
    expect(q.total.toString()).toBe('0.6');
  });

  it('caps precision at the column’s 4 decimals', () => {
    const q = computeQuote({ amountUsdt: D('1'), rate: D('1.123456'), feePercent: D('0'), feeFixedUsdt: D('0'), decimals: 8 });
    expect(q.subtotal.toString()).toBe('1.1235');
  });
});

describe('normalizeConfig', () => {
  it('is off with the defaults when nothing is stored', () => {
    expect(normalizeConfig(null)).toEqual(DEFAULT_USDT_CONFIG);
    expect(normalizeConfig('junk').enabled).toBe(false);
  });

  it('keeps valid values and drops broken ones', () => {
    const c = normalizeConfig({
      enabled: true,
      rates: { MRU: '41.5', usd: '1', XOF: '-3', EUR: 'abc', USD: 1.02 },
      feePercent: 2,
      feeFixedUsdt: 'x',
      minUsdt: '5',
      maxUsdt: '500',
      networks: { TRC20: false, BEP20: 'yes' },
      binanceEnabled: false,
      expiryMinutes: 2,
    });
    expect(c.enabled).toBe(true);
    expect(c.rates).toEqual({ MRU: '41.5', USD: '1.02' });
    expect(c.feePercent).toBe('2');
    expect(c.feeFixedUsdt).toBe('0');
    expect(c.networks).toEqual({ TRC20: false, BEP20: true, ERC20: false });
    expect(c.binanceEnabled).toBe(false);
    expect(c.expiryMinutes).toBe(30);
  });

  it('enables only on a literal true', () => {
    expect(normalizeConfig({ enabled: 'true' }).enabled).toBe(false);
  });
});

describe('status machine', () => {
  const S = UsdtOrderStatus;

  it('follows NEW → AWAITING_PAYMENT → UNDER_REVIEW → READY_TO_SEND → COMPLETED', () => {
    expect(canMove(S.NEW, S.AWAITING_PAYMENT)).toBe(true);
    expect(canMove(S.AWAITING_PAYMENT, S.UNDER_REVIEW)).toBe(true);
    expect(canMove(S.UNDER_REVIEW, S.READY_TO_SEND)).toBe(true);
    expect(canMove(S.READY_TO_SEND, S.COMPLETED)).toBe(true);
  });

  it('never skips review or goes backwards', () => {
    expect(canMove(S.AWAITING_PAYMENT, S.READY_TO_SEND)).toBe(false);
    expect(canMove(S.AWAITING_PAYMENT, S.COMPLETED)).toBe(false);
    expect(canMove(S.UNDER_REVIEW, S.COMPLETED)).toBe(false);
    expect(canMove(S.READY_TO_SEND, S.UNDER_REVIEW)).toBe(false);
    expect(canMove(S.UNDER_REVIEW, S.CANCELLED)).toBe(false); // a paid order is rejected by staff, not cancelled
  });

  it('treats COMPLETED, REJECTED and CANCELLED as final', () => {
    for (const s of [S.COMPLETED, S.REJECTED, S.CANCELLED]) {
      expect(isFinal(s)).toBe(true);
      for (const to of Object.values(S)) expect(canMove(s, to)).toBe(false);
    }
    expect(isFinal(S.UNDER_REVIEW)).toBe(false);
  });
});
