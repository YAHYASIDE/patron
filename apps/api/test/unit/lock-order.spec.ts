import { acquireLocks, lock, LockRank } from '../../src/common/locking/lock-order';

describe('lock-order', () => {
  let tx: any;

  beforeEach(() => {
    tx = { $queryRawUnsafe: jest.fn().mockResolvedValue([]) };
  });

  const calls = () => tx.$queryRawUnsafe.mock.calls;

  describe('LockRank', () => {
    it('encodes the canonical wallet → order → payment → refund order', () => {
      expect(LockRank.WALLET).toBeLessThan(LockRank.ORDER);
      expect(LockRank.ORDER).toBeLessThan(LockRank.PAYMENT);
      expect(LockRank.PAYMENT).toBeLessThan(LockRank.REFUND);
    });
  });

  describe('lock', () => {
    it('builds a resource descriptor', () => {
      expect(lock(LockRank.ORDER, 'o1')).toEqual({ rank: LockRank.ORDER, id: 'o1' });
    });
  });

  describe('acquireLocks', () => {
    it('acquires nothing for an empty resource list', async () => {
      await acquireLocks(tx, []);
      expect(tx.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('locks each resource against its canonical table with a FOR UPDATE clause', async () => {
      await acquireLocks(tx, [lock(LockRank.WALLET, 'w1')]);
      const [sql, id] = calls()[0];
      expect(sql).toContain('FROM "wallets"');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('$1::uuid');
      expect(id).toBe('w1');
    });

    it('reorders resources into canonical rank order regardless of caller sequence', async () => {
      await acquireLocks(tx, [
        lock(LockRank.REFUND, 'r1'),
        lock(LockRank.WALLET, 'w1'),
        lock(LockRank.PAYMENT, 'p1'),
        lock(LockRank.ORDER, 'o1'),
      ]);
      const tables = calls().map(([sql]: [string]) => sql.match(/FROM "(\w+)"/)![1]);
      expect(tables).toEqual(['wallets', 'orders', 'payments', 'refunds']);
    });

    it('sorts ids within the same rank so two txns lock a shared pair in one order', async () => {
      await acquireLocks(tx, [
        lock(LockRank.WALLET, 'w-zzz'),
        lock(LockRank.WALLET, 'w-aaa'),
      ]);
      const ids = calls().map(([, id]: [string, string]) => id);
      expect(ids).toEqual(['w-aaa', 'w-zzz']);
    });

    it('does not mutate the caller-supplied array', async () => {
      const resources = [lock(LockRank.REFUND, 'r1'), lock(LockRank.WALLET, 'w1')];
      const snapshot = [...resources];
      await acquireLocks(tx, resources);
      expect(resources).toEqual(snapshot);
    });
  });
});
