import { BadRequestException } from '@nestjs/common';
import { Prisma, WalletTxnType } from '@prisma/client';
import { WalletService } from '../../src/modules/wallet/wallet.service';

const makeTx = (overrides: any = {}) => ({
  $queryRawUnsafe: jest.fn().mockResolvedValue([]),
  wallet: {
    findUnique: jest.fn().mockResolvedValue({ id: 'w1' }),
    create: jest.fn().mockResolvedValue({ id: 'w1' }),
    findUniqueOrThrow: jest.fn().mockResolvedValue({ balance: new Prisma.Decimal(100) }),
    update: jest.fn().mockResolvedValue({}),
  },
  walletTransaction: { create: jest.fn().mockResolvedValue({}) },
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  ...overrides,
});

describe('WalletService', () => {
  let prisma: any;
  let service: WalletService;

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'w1' }),
        create: jest.fn().mockResolvedValue({ id: 'w1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      walletTransaction: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new WalletService(prisma);
  });

  describe('getOrCreate', () => {
    it('returns an existing wallet without creating one', async () => {
      const res = await service.getOrCreate('u1', 'USD');
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { userId_currencyCode: { userId: 'u1', currencyCode: 'USD' } },
      });
      expect(prisma.wallet.create).not.toHaveBeenCalled();
      expect(res).toEqual({ id: 'w1' });
    });

    it('creates a wallet when none exists yet', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);
      await service.getOrCreate('u1', 'USD');
      expect(prisma.wallet.create).toHaveBeenCalledWith({ data: { userId: 'u1', currencyCode: 'USD' } });
    });

    it('uses the supplied transaction client when given one', async () => {
      const tx = makeTx();
      tx.wallet.findUnique.mockResolvedValue(null);
      await service.getOrCreate('u1', 'USD', tx as any);
      expect(tx.wallet.create).toHaveBeenCalled();
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('listForUser / history', () => {
    it('includes currency metadata for each wallet', () => {
      void service.listForUser('u1');
      expect(prisma.wallet.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });

    it('filters history by currency only when one is provided', () => {
      void service.history('u1', 'USD');
      expect(prisma.walletTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u1', currency: 'USD' } }),
      );

      void service.history('u1');
      expect(prisma.walletTransaction.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { userId: 'u1' } }),
      );
    });
  });

  describe('post', () => {
    it('locks the wallet, applies a credit, and writes a ledger row', async () => {
      const tx = makeTx();
      const res = await service.post(
        { userId: 'u1', currency: 'USD', amount: 50, type: WalletTxnType.ADMIN_ADJUSTMENT },
        tx as any,
      );

      // SELECT ... FOR UPDATE was taken before the read-modify-write.
      expect(tx.$queryRawUnsafe).toHaveBeenCalled();
      expect(res.balanceAfter.toString()).toBe('150');

      const update = tx.wallet.update.mock.calls[0][0];
      expect(update.data.balance.toString()).toBe('150');
      expect(update.data.version).toEqual({ increment: 1 });

      const ledger = tx.walletTransaction.create.mock.calls[0][0].data;
      expect(ledger.balanceBefore.toString()).toBe('100');
      expect(ledger.balanceAfter.toString()).toBe('150');
      expect(ledger.walletId).toBe('w1');
    });

    it('rejects a debit that would overdraw the wallet and writes nothing', async () => {
      const tx = makeTx();
      await expect(
        service.post(
          { userId: 'u1', currency: 'USD', amount: -200, type: WalletTxnType.ORDER_PAYMENT },
          tx as any,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(tx.wallet.update).not.toHaveBeenCalled();
      expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    });

    it('allows a debit that lands exactly on zero', async () => {
      const tx = makeTx();
      const res = await service.post(
        { userId: 'u1', currency: 'USD', amount: -100, type: WalletTxnType.ORDER_PAYMENT },
        tx as any,
      );
      expect(res.balanceAfter.toString()).toBe('0');
    });
  });

  describe('debit / credit', () => {
    it('debit negates the amount before posting', async () => {
      const tx = makeTx();
      await service.debit({ userId: 'u1', currency: 'USD', amount: 40, type: WalletTxnType.ORDER_PAYMENT }, tx as any);
      const ledger = tx.walletTransaction.create.mock.calls[0][0].data;
      expect(ledger.amount.toString()).toBe('-40');
      expect(ledger.balanceAfter.toString()).toBe('60');
    });

    it('credit posts the positive amount', async () => {
      const tx = makeTx();
      await service.credit({ userId: 'u1', currency: 'USD', amount: 40, type: WalletTxnType.REFUND }, tx as any);
      const ledger = tx.walletTransaction.create.mock.calls[0][0].data;
      expect(ledger.amount.toString()).toBe('40');
      expect(ledger.balanceAfter.toString()).toBe('140');
    });
  });

  describe('lockWallet', () => {
    it('resolves-or-creates the wallet then takes its lock, returning the row', async () => {
      const tx = makeTx();
      const wallet = await service.lockWallet('u1', 'USD', tx as any);
      expect(tx.$queryRawUnsafe).toHaveBeenCalled();
      expect(wallet).toEqual({ id: 'w1' });
    });
  });

  describe('adjust', () => {
    it('posts the entry and audits it inside a single transaction', async () => {
      const tx = makeTx();
      prisma.$transaction.mockImplementation((fn: any) => fn(tx));

      const res = await service.adjust('u1', 'USD', 25, 'goodwill', 'admin-1');

      expect(res.balanceAfter.toString()).toBe('125');
      const ledger = tx.walletTransaction.create.mock.calls[0][0].data;
      expect(ledger.type).toBe(WalletTxnType.ADMIN_ADJUSTMENT);
      expect(ledger.description).toBe('goodwill');
      expect(ledger.createdById).toBe('admin-1');

      const audit = tx.auditLog.create.mock.calls[0][0].data;
      expect(audit.action).toBe('wallet.adjust');
      expect(audit.userId).toBe('admin-1');
      expect(audit.entityId).toBe('u1');
    });
  });

  describe('findDrift / findDriftFull', () => {
    it('scopes drift detection to the last 48h by default', async () => {
      await service.findDrift();
      const cutoff = prisma.$queryRaw.mock.calls[0][1] as Date;
      const ageMs = Date.now() - cutoff.getTime();
      expect(ageMs).toBeGreaterThan(47 * 3_600_000);
      expect(ageMs).toBeLessThan(49 * 3_600_000);
    });

    it('honours an explicit since date', async () => {
      const since = new Date('2020-01-01T00:00:00Z');
      await service.findDrift(since);
      expect(prisma.$queryRaw.mock.calls[0][1]).toBe(since);
    });

    it('full sweep starts from the epoch', async () => {
      await service.findDriftFull();
      expect((prisma.$queryRaw.mock.calls[0][1] as Date).getTime()).toBe(0);
    });
  });
});
