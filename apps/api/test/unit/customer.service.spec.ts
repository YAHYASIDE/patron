import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CustomerService, MAX_FAVORITES } from '../../src/modules/customer/customer.service';

const GAME = '11111111-1111-4111-8111-111111111111';

describe('CustomerService', () => {
  let prisma: any;
  let tx: any;
  let service: CustomerService;

  beforeEach(() => {
    tx = {
      savedInput: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        create: jest.fn((a: any) => Promise.resolve({ id: 'new', ...a.data })),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      game: {
        findFirst: jest.fn().mockResolvedValue({
          inputSchema: [
            { key: 'playerId', type: 'text' },
            { key: 'zone', type: 'select' },
            { key: 'password', type: 'password' },
            { key: 'pin', type: 'text', sensitive: true },
          ],
        }),
      },
      savedInput: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      favorite: {
        findMany: jest.fn().mockResolvedValue([{ brandKey: 'g-pubg-mobile' }, { brandKey: 'gc-apple-us' }]),
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    service = new CustomerService(prisma);
  });

  describe('saved inputs', () => {
    it('lists newest first, optionally for one game', async () => {
      await service.listSavedInputs('u1', GAME);
      expect(prisma.savedInput.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: 'u1', gameId: GAME }, orderBy: { updatedAt: 'desc' },
      }));
      await service.listSavedInputs('u1');
      expect(prisma.savedInput.findMany.mock.calls[1][0].where).toEqual({ userId: 'u1' });
    });

    it('keeps only the game\'s non-sensitive fields, trimmed', async () => {
      const row = await service.saveInput('u1', {
        gameId: GAME,
        label: '  حسابي ',
        values: { playerId: ' 5123 ', zone: '', password: 'secret', pin: '1234', other: 'x', bad: 5 },
      });
      expect(tx.savedInput.create).toHaveBeenCalledWith(expect.objectContaining({
        data: { userId: 'u1', gameId: GAME, label: 'حسابي', values: { playerId: '5123' } },
      }));
      expect(row).toMatchObject({ id: 'new' });
      expect(tx.savedInput.deleteMany).not.toHaveBeenCalled();
    });

    it('refuses a missing game, nothing to save and an over-long value', async () => {
      prisma.game.findFirst.mockResolvedValueOnce(null);
      await expect(service.saveInput('u1', { gameId: GAME, values: { playerId: '1' } })).rejects.toThrow(NotFoundException);
      await expect(service.saveInput('u1', { gameId: GAME, values: { password: 'x' } }))
        .rejects.toMatchObject({ response: expect.objectContaining({ error: 'NOTHING_TO_SAVE' }) });
      await expect(service.saveInput('u1', { gameId: GAME, values: { playerId: 'x'.repeat(201) } }))
        .rejects.toThrow(BadRequestException);
    });

    it('treats a game without an input list as nothing to save', async () => {
      prisma.game.findFirst.mockResolvedValueOnce({ inputSchema: null });
      await expect(service.saveInput('u1', { gameId: GAME, values: { playerId: '1' } })).rejects.toThrow(BadRequestException);
    });

    it('moves the same values to the top instead of adding them twice', async () => {
      tx.savedInput.findMany.mockResolvedValue([
        { id: 's1', values: { zone: 'eu', playerId: '42' }, label: 'old' },
        { id: 's2', values: ['not', 'an', 'object'], label: null },
      ]);
      await service.saveInput('u1', { gameId: GAME, values: { playerId: '42', zone: 'eu' } });
      expect(tx.savedInput.create).not.toHaveBeenCalled();
      const update = tx.savedInput.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 's1' });
      expect(update.data.updatedAt).toBeInstanceOf(Date);
      expect(update.data).not.toHaveProperty('label');

      await service.saveInput('u1', { gameId: GAME, label: 'new', values: { playerId: '42', zone: 'eu' } });
      expect(tx.savedInput.update.mock.calls[1][0].data.label).toBe('new');
    });

    it('does not match values that differ in one key', async () => {
      tx.savedInput.findMany.mockResolvedValue([{ id: 's1', values: { playerId: '42' }, label: null }]);
      await service.saveInput('u1', { gameId: GAME, values: { playerId: '42', zone: 'eu' } });
      expect(tx.savedInput.create).toHaveBeenCalled();
    });

    it('keeps at most 10 per game, dropping the oldest', async () => {
      tx.savedInput.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, values: { playerId: String(i) }, label: null })),
      );
      await service.saveInput('u1', { gameId: GAME, values: { playerId: 'new' } });
      expect(tx.savedInput.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['s9'] } } });
    });

    it('deletes only the caller\'s own row', async () => {
      await expect(service.deleteSavedInput('u1', 's1')).resolves.toEqual({ deleted: true });
      expect(prisma.savedInput.deleteMany).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1' } });
      prisma.savedInput.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deleteSavedInput('u1', 'other')).rejects.toThrow(NotFoundException);
    });
  });

  describe('favourites', () => {
    it('lists brand keys newest first', async () => {
      await expect(service.listFavorites('u1')).resolves.toEqual(['g-pubg-mobile', 'gc-apple-us']);
      expect(prisma.favorite.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
    });

    it('adds a favourite idempotently', async () => {
      await expect(service.addFavorite('u1', 'sub-nflx')).resolves.toEqual({ brandKey: 'sub-nflx' });
      expect(prisma.favorite.upsert).toHaveBeenCalledWith({
        where: { userId_brandKey: { userId: 'u1', brandKey: 'sub-nflx' } },
        create: { userId: 'u1', brandKey: 'sub-nflx' },
        update: {},
      });
    });

    it('refuses a malformed key and too many favourites', async () => {
      await expect(service.addFavorite('u1', 'Bad Key')).rejects.toThrow(BadRequestException);
      await expect(service.addFavorite('u1', 'x')).rejects.toThrow(BadRequestException);
      prisma.favorite.count.mockResolvedValue(MAX_FAVORITES);
      await expect(service.addFavorite('u1', 'g-ok')).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'TOO_MANY_FAVORITES' }),
      });
      expect(prisma.favorite.upsert).not.toHaveBeenCalled();
    });

    it('removes a favourite', async () => {
      await expect(service.removeFavorite('u1', 'g-pubg-mobile')).resolves.toEqual({ deleted: true });
      expect(prisma.favorite.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1', brandKey: 'g-pubg-mobile' } });
    });
  });

  describe('my codes', () => {
    it('lists delivered items of the caller with what was revealed, values never included', async () => {
      const deliveredAt = new Date('2026-10-18T10:00:00Z');
      prisma.orderItem.findMany.mockResolvedValue([{
        id: 'i1', productId: 'p1', productNameAr: 'ببجي', productNameEn: 'PUBG', quantity: 2, deliveredAt,
        order: { id: 'o1', orderNumber: 'PTN-1' },
        results: [{ id: 'r1', resultType: 'code', viewedAt: new Date() }, { id: 'r2', resultType: 'code', viewedAt: null }],
      }]);

      const rows = await service.myCodes('u1');

      const args = prisma.orderItem.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ status: 'DELIVERED', order: { userId: 'u1' }, results: { some: {} } });
      expect(args.select.results.select).not.toHaveProperty('valueEnc');
      expect(rows).toEqual([{
        orderId: 'o1', orderNumber: 'PTN-1', itemId: 'i1', productId: 'p1', productNameAr: 'ببجي',
        productNameEn: 'PUBG', quantity: 2, deliveredAt,
        results: [{ id: 'r1', resultType: 'code', revealed: true }, { id: 'r2', resultType: 'code', revealed: false }],
      }]);
    });
  });
});
