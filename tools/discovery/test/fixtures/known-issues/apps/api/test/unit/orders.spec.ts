// Fixture: a focused test and a skipped one (the comment below must not count: it.only('x')).
describe('orders', () => {
  it.only('captures a paid order once', () => {
    expect(1).toBe(1);
  });

  it('refunds to the wallet', () => {
    expect(2).toBe(2);
  });

  describe.skip('legacy coupons', () => {
    it('applies a fixed discount', () => {
      expect(3).toBe(3);
    });
  });

  xit('sends a receipt', () => {
    expect(4).toBe(4);
  });
});
