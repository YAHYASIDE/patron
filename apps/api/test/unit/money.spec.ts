import { Prisma } from '@prisma/client';
import { D, roundMoney, sum, serialiseMoney } from '../../src/common/money/money';

describe('money', () => {
  it('does not lose precision the way floats do', () => {
    expect(sum([D('0.1'), D('0.2')]).equals(D('0.3'))).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3); // the reason this module exists
  });

  describe('roundMoney', () => {
    it('rounds to the currency’s minor unit', () => {
      expect(roundMoney(D('4.005'), 2).toString()).toBe('4.01');
    });

    it('drops fractions entirely for zero-decimal currencies like XOF', () => {
      expect(roundMoney(D('2847.62'), 0).toString()).toBe('2848');
    });

    it('snaps to a rounding step', () => {
      expect(roundMoney(D('2847'), 0, 'HALF_UP', D(5)).toString()).toBe('2845');
      expect(roundMoney(D('2848'), 0, 'HALF_UP', D(5)).toString()).toBe('2850');
    });

    it('honours DOWN so we never round a price up by accident', () => {
      expect(roundMoney(D('4.999'), 2, 'DOWN').toString()).toBe('4.99');
    });
  });

  it('serialises Decimals as strings, not lossy JSON numbers', () => {
    const result = serialiseMoney({ total: new Prisma.Decimal('12345678.1234') });
    expect(result.total).toBe('12345678.1234');
  });
});
