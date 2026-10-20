import '../../src/common/serialization/bigint-json';

describe('BigInt JSON', () => {
  it('serialises raw-query counts as numbers instead of throwing', () => {
    expect(JSON.stringify({ items: BigInt(42), rows: [{ n: BigInt(0) }] })).toBe('{"items":42,"rows":[{"n":0}]}');
  });
});
