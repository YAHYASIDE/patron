import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/catalog.dto';
import { toAuditJson } from '../../common/audit/audit.service';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  /** Storefront tree — active only, two levels deep. */
  findTree() {
    return this.prisma.category.findMany({
      where: { deletedAt: null, isActive: true, parentId: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        children: {
          where: { deletedAt: null, isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
  }

  findAll() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
      include: { _count: { select: { products: true, games: true } } },
    });
  }

  async findOne(idOrSlug: string) {
    const category = await this.prisma.category.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { children: { where: { deletedAt: null } }, parent: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async create(dto: CreateCategoryDto, actorId: string) {
    if (dto.parentId) await this.assertExists(dto.parentId);

    const category = await this.prisma.category.create({ data: dto });
    await this.audit(actorId, 'catalog.category.create', category.id, null, category);
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string) {
    const before = await this.assertExists(id);
    if (dto.parentId === id) throw new BadRequestException('A category cannot be its own parent');
    if (dto.parentId) await this.assertNoCycle(id, dto.parentId);

    const after = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit(actorId, 'catalog.category.update', id, before, after);
    return after;
  }

  async remove(id: string, actorId: string) {
    await this.assertExists(id);

    const [products, children] = await this.prisma.$transaction([
      this.prisma.product.count({ where: { categoryId: id, deletedAt: null } }),
      this.prisma.category.count({ where: { parentId: id, deletedAt: null } }),
    ]);
    if (products > 0) throw new BadRequestException(`${products} product(s) still use this category`);
    if (children > 0) throw new BadRequestException(`${children} subcategory(ies) still use this category`);

    await this.prisma.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit(actorId, 'catalog.category.delete', id, null, null);
    return { message: 'Category deleted' };
  }

  private async assertExists(id: string) {
    const category = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  /** Walk up the ancestry so a reparent can't create an orphan loop. */
  private async assertNoCycle(id: string, newParentId: string) {
    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === id) throw new BadRequestException('That parent would create a cycle');
      if (seen.has(cursor)) break;
      seen.add(cursor);
      const parent: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = parent?.parentId ?? null;
    }
  }

  private audit(userId: string, action: string, entityId: string, before: unknown, after: unknown) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Category', entityId, before: toAuditJson(before), after: toAuditJson(after) },
    });
  }
}
