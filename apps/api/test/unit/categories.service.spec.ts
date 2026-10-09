import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from '../../src/modules/catalog/categories.service';

const category = (over: Partial<any> = {}) => ({
  id: 'c1', slug: 'games', nameEn: 'Games', nameAr: 'ألعاب',
  parentId: null, deletedAt: null, isActive: true, ...over,
});

describe('CategoriesService', () => {
  let prisma: any;
  let service: CategoriesService;

  beforeEach(() => {
    prisma = {
      category: {
        findMany: jest.fn().mockResolvedValue([category()]),
        findFirst: jest.fn().mockResolvedValue(category()),
        findUnique: jest.fn().mockResolvedValue({ parentId: null }),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c-new', ...data })),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'c1', ...data })),
      },
      product: { count: jest.fn().mockResolvedValue(0) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
    };
    service = new CategoriesService(prisma);
  });

  describe('findTree', () => {
    it('queries only active top-level categories with active children', () => {
      void service.findTree();
      const args = prisma.category.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null, isActive: true, parentId: null });
      expect(args.include.children.where).toEqual({ deletedAt: null, isActive: true });
    });
  });

  describe('findAll', () => {
    it('returns non-deleted categories with product/game counts', () => {
      void service.findAll();
      const args = prisma.category.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ deletedAt: null });
      expect(args.include._count.select).toEqual({ products: true, games: true });
    });
  });

  describe('findOne', () => {
    it('resolves by id or slug', async () => {
      const res = await service.findOne('games');
      expect(res).toEqual(category());
      const where = prisma.category.findFirst.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ id: 'games' }, { slug: 'games' }]);
    });

    it('throws NotFound when missing', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.findOne('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a root category without a parent check', async () => {
      const dto = { slug: 'x', nameEn: 'X', nameAr: 'X' } as any;
      const res = await service.create(dto, 'admin1');
      expect(prisma.category.create).toHaveBeenCalledWith({ data: dto });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'catalog.category.create' }) }),
      );
      expect(res.slug).toBe('x');
    });

    it('verifies the parent exists when parentId is supplied', async () => {
      const dto = { slug: 'x', nameEn: 'X', nameAr: 'X', parentId: 'p1' } as any;
      await service.create(dto, 'admin1');
      expect(prisma.category.findFirst).toHaveBeenCalledWith({ where: { id: 'p1', deletedAt: null } });
    });

    it('rejects a non-existent parent', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      const dto = { slug: 'x', nameEn: 'X', nameAr: 'X', parentId: 'missing' } as any;
      await expect(service.create(dto, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.category.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates and audits before/after', async () => {
      const res = await service.update('c1', { nameEn: 'New' } as any, 'admin1');
      expect(prisma.category.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { nameEn: 'New' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'catalog.category.update' }) }),
      );
      expect(res.nameEn).toBe('New');
    });

    it('throws NotFound when the category does not exist', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.update('nope', {} as any, 'admin1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects making a category its own parent', async () => {
      await expect(service.update('c1', { parentId: 'c1' } as any, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('rejects a reparent that would create a cycle', async () => {
      // new parent p1 -> its ancestor is c1 (the category being updated) => cycle
      prisma.category.findUnique.mockResolvedValueOnce({ parentId: 'c1' });
      await expect(service.update('c1', { parentId: 'p1' } as any, 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('allows a reparent to an unrelated branch', async () => {
      // walk up: p1 -> root (null), never hits c1
      prisma.category.findUnique.mockResolvedValueOnce({ parentId: null });
      await expect(service.update('c1', { parentId: 'p1' } as any, 'admin1')).resolves.toBeDefined();
      expect(prisma.category.update).toHaveBeenCalled();
    });

    it('stops walking the ancestry if it detects a pre-existing loop', async () => {
      // p1 -> p2 -> p1 (already-looping data, none equal c1): must break, not spin
      prisma.category.findUnique
        .mockResolvedValueOnce({ parentId: 'p2' })
        .mockResolvedValueOnce({ parentId: 'p1' });
      await expect(service.update('c1', { parentId: 'p1' } as any, 'admin1')).resolves.toBeDefined();
    });
  });

  describe('remove', () => {
    it('soft-deletes an empty category and audits it', async () => {
      const res = await service.remove('c1', 'admin1');
      const call = prisma.category.update.mock.calls[0][0];
      expect(call.data.isActive).toBe(false);
      expect(call.data.deletedAt).toBeInstanceOf(Date);
      expect(res).toEqual({ message: 'Category deleted' });
    });

    it('refuses to delete a category that still has products', async () => {
      prisma.$transaction.mockResolvedValueOnce([2, 0]);
      await expect(service.remove('c1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('refuses to delete a category that still has subcategories', async () => {
      prisma.$transaction.mockResolvedValueOnce([0, 1]);
      await expect(service.remove('c1', 'admin1')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.category.update).not.toHaveBeenCalled();
    });

    it('throws NotFound when the category does not exist', async () => {
      prisma.category.findFirst.mockResolvedValue(null);
      await expect(service.remove('nope', 'admin1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
