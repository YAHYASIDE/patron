import { BadRequestException, NotFoundException } from '@nestjs/common';
import { GamesService } from '../../src/modules/catalog/games.service';

const query = (over: Partial<any> = {}) =>
  ({ page: 1, limit: 20, skip: 0, order: 'desc', ...over }) as any;

const game = (over: Partial<any> = {}) => ({
  id: 'g1', slug: 'valorant', nameEn: 'Valorant', nameAr: 'فالورانت',
  categoryId: 'c1', deletedAt: null, isActive: true, ...over,
});

describe('GamesService', () => {
  let prisma: any;
  let service: GamesService;

  beforeEach(() => {
    prisma = {
      game: {
        findMany: jest.fn().mockResolvedValue([game()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(game()),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'g-new', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'g1', ...data })),
      },
      product: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
    };
    service = new GamesService(prisma);
  });

  describe('findAll', () => {
    it('lists active games only by default and paginates the result', async () => {
      const res = await service.findAll(query());

      const where = prisma.game.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ deletedAt: null, isActive: true });
      expect(res).toEqual({ data: [game()], meta: { page: 1, limit: 20, total: 1, pages: 1 } });
    });

    it('includes inactive games when asked (admin listing)', async () => {
      await service.findAll(query(), true);
      const where = prisma.game.findMany.mock.calls[0][0].where;
      expect(where.isActive).toBeUndefined();
    });

    it('applies category, featured and search filters', async () => {
      await service.findAll(query({ categoryId: 'c9', isFeatured: false, search: 'val' }));
      const where = prisma.game.findMany.mock.calls[0][0].where;
      expect(where.categoryId).toBe('c9');
      expect(where.isFeatured).toBe(false);
      expect(where.OR).toEqual([
        { nameEn: { contains: 'val', mode: 'insensitive' } },
        { nameAr: { contains: 'val' } },
      ]);
    });

    it('reports the true total for pagination even when a page is empty', async () => {
      prisma.game.findMany.mockResolvedValue([]);
      prisma.game.count.mockResolvedValue(45);
      const res = await service.findAll(query({ page: 3, limit: 20 }));
      expect(res.data).toEqual([]);
      expect(res.meta).toEqual({ page: 3, limit: 20, total: 45, pages: 3 });
    });
  });

  describe('findOne', () => {
    it('resolves by id or slug', async () => {
      const res = await service.findOne('valorant');
      expect(res).toEqual(game());
      const where = prisma.game.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ id: 'valorant' }, { slug: 'valorant' }]);
    });

    it('throws NotFound when the game is missing', async () => {
      prisma.game.findFirst.mockResolvedValue(null);
      await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates the game and writes an audit entry', async () => {
      const dto = { slug: 'lol', nameEn: 'LoL', nameAr: 'ل', categoryId: 'c1' } as any;
      const res = await service.create(dto, 'admin1');

      expect(prisma.game.create).toHaveBeenCalledWith({ data: dto });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'catalog.game.create', entityType: 'Game', userId: 'admin1' }),
        }),
      );
      expect(res.slug).toBe('lol');
    });

    it('rejects duplicate input-schema keys before touching the database', async () => {
      const dto = {
        slug: 'lol', nameEn: 'LoL', nameAr: 'ل', categoryId: 'c1',
        inputSchema: [
          { key: 'player_id', labelEn: 'a', labelAr: 'a', type: 'text', required: true },
          { key: 'player_id', labelEn: 'b', labelAr: 'b', type: 'text', required: true },
        ],
      } as any;

      await expect(service.create(dto, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.game.create).not.toHaveBeenCalled();
    });

    it('accepts a schema with distinct keys', async () => {
      const dto = {
        slug: 'lol', nameEn: 'LoL', nameAr: 'ل', categoryId: 'c1',
        inputSchema: [
          { key: 'player_id', labelEn: 'a', labelAr: 'a', type: 'text', required: true },
          { key: 'region', labelEn: 'b', labelAr: 'b', type: 'text', required: true },
        ],
      } as any;

      await expect(service.create(dto, 'admin1')).resolves.toBeDefined();
      expect(prisma.game.create).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates an existing game and audits before/after', async () => {
      const res = await service.update('g1', { nameEn: 'New' } as any, 'admin1');
      expect(prisma.game.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { nameEn: 'New' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'catalog.game.update' }) }),
      );
      expect(res.nameEn).toBe('New');
    });

    it('throws NotFound when the game does not exist', async () => {
      prisma.game.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', {} as any, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.game.update).not.toHaveBeenCalled();
    });

    it('validates input-schema keys on update too', async () => {
      const dto = {
        inputSchema: [
          { key: 'dup', labelEn: 'a', labelAr: 'a', type: 'text', required: true },
          { key: 'dup', labelEn: 'b', labelAr: 'b', type: 'text', required: true },
        ],
      } as any;
      await expect(service.update('g1', dto, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('remove', () => {
    it('soft-deletes the game and audits it', async () => {
      const res = await service.remove('g1', 'admin1');
      const call = prisma.game.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'g1' });
      expect(call.data.isActive).toBe(false);
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(res).toEqual({ message: 'Game deleted' });
    });

    it('refuses to delete a game that still has products', async () => {
      prisma.product.count.mockResolvedValue(3);
      await expect(service.remove('g1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.game.update).not.toHaveBeenCalled();
    });
  });
});
