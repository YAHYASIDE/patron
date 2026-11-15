/**
 * Postgres COUNT() and SUM() over integers come back from raw queries as
 * BigInt, which JSON.stringify refuses ("Do not know how to serialize a
 * BigInt"): every report built on $queryRaw answered 500. Counts and sums here
 * stay far below 2^53, so they serialise as plain numbers.
 */
declare global {
  interface BigInt {
    toJSON(): number;
  }
}

BigInt.prototype.toJSON = function toJSON(this: bigint) {
  return Number(this);
};

export {};
