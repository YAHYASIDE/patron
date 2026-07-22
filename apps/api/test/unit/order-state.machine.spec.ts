import {
  assertTransition, canTransition, deriveOrderStatus,
} from '../../src/modules/orders/order-state.machine';

describe('order state machine', () => {
  describe('transitions', () => {
    it('allows the happy path', () => {
      expect(canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
      expect(canTransition('PAID', 'PROCESSING')).toBe(true);
      expect(canTransition('PROCESSING', 'COMPLETED')).toBe(true);
    });

    it('refuses to resurrect a terminal order', () => {
      expect(canTransition('REFUNDED', 'PROCESSING')).toBe(false);
      expect(canTransition('CANCELLED', 'PAID')).toBe(false);
      expect(() => assertTransition('CANCELLED', 'PAID')).toThrow(/Illegal order transition/);
    });

    it('refuses to skip payment', () => {
      expect(canTransition('PENDING_PAYMENT', 'COMPLETED')).toBe(false);
    });

    it('treats a no-op transition as valid', () => {
      expect(() => assertTransition('PAID', 'PAID')).not.toThrow();
    });
  });

  describe('deriveOrderStatus', () => {
    it('is COMPLETED only when every item is delivered', () => {
      expect(deriveOrderStatus(['DELIVERED', 'DELIVERED'])).toBe('COMPLETED');
    });

    it('is PARTIALLY_COMPLETED on a mixed final outcome', () => {
      expect(deriveOrderStatus(['DELIVERED', 'FAILED'])).toBe('PARTIALLY_COMPLETED');
    });

    it('stays PROCESSING while anything is unfinished', () => {
      expect(deriveOrderStatus(['DELIVERED', 'PENDING'])).toBe('PROCESSING');
      expect(deriveOrderStatus(['FAILED', 'PROCESSING'])).toBe('PROCESSING');
    });

    it('is FAILED when everything failed', () => {
      expect(deriveOrderStatus(['FAILED', 'FAILED'])).toBe('FAILED');
    });

    it('is REFUNDED only when every item is refunded', () => {
      expect(deriveOrderStatus(['REFUNDED', 'REFUNDED'])).toBe('REFUNDED');
      expect(deriveOrderStatus(['REFUNDED', 'DELIVERED'])).toBe('PARTIALLY_COMPLETED');
    });
  });
});
