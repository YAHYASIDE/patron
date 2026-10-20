import { Prisma } from '@prisma/client';

export type Money = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value): Money => new Prisma.Decimal(v);
export const ZERO = () => new Prisma.Decimal(0);

/**
 * All money arithmetic goes through Decimal. Floats are never used for money:
 * 0.1 + 0.2 !== 0.3 becomes a real accounting discrepancy at scale.
 */
export const sum = (values: Money[]): Money => values.reduce((a, b) => a.plus(b), ZERO());

export const ROUNDING = {
  HALF_UP: Prisma.Decimal.ROUND_HALF_UP,
  UP: Prisma.Decimal.ROUND_UP,
  DOWN: Prisma.Decimal.ROUND_DOWN,
} as const;

export type RoundingMode = keyof typeof ROUNDING;

/** Currency-aware rounding: XOF has no minor unit, step snaps to increments. */
export function roundMoney(
  value: Money,
  decimals: number,
  mode: RoundingMode = 'HALF_UP',
  step?: Money | null,
): Money {
  const rounding = ROUNDING[mode] ?? ROUNDING.HALF_UP;
  let result = value.toDecimalPlaces(decimals, rounding);
  if (step && step.gt(0)) result = result.div(step).toDecimalPlaces(0, rounding).mul(step);
  return result;
}

/** Serialise Decimals as strings — JSON numbers silently lose precision. */
export function serialiseMoney<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (v instanceof Prisma.Decimal ? v.toString() : v)),
  );
}
