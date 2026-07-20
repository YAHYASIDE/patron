import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/dto/pagination.dto';
import { CreateGameDto, QueryCatalogDto, UpdateGameDto } from './dto/catalog.dto';

@Injectable()
export class GamesService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: QueryCatalogDto, includeInactive = false) {
    const where: Prisma.GameWhereInput = {
      deletedAt: null,
      ...(includeInactive ? {} : { isActive: true }),
      ...(query.categoryId && { categoryId: query.categoryId }),
      ...(query.isFeatured !== undefined && { isFeatured: query.isFeatured }),
      ...(query.search && {
        OR: [
          { nameEn: { contains: query.search, mode: 'insensitive' } },
          { nameAr: { contains: query.search } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.game.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        include: {
          category: { select: { id: true, slug: true, nameAr: true, nameEn: true } },
          _count: { select: { products: true } },
        },
      }),
      this.prisma.game.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async findOne(idOrSlug: string) {
    const game = await this.prisma.game.findFirst({
      where: { deletedAt: null, OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: { category: true },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  async create(dto: CreateGameDto, actorId: string) {
    this.assertUniqueInputKeys(dto);
    const game = await this.prisma.game.create({ data: dto as Prisma.GameUncheckedCreateInput });
    await this.audit(actorId, 'catalog.game.create', game.id, null, game);
    return game;
  }

  async update(id: string, dto: UpdateGameDto, actorId: string) {
    const before = await this.prisma.game.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Game not found');
    this.assertUniqueInputKeys(dto);

    const after = await this.prisma.game.update({ where: { id }, data: dto as Prisma.GameUncheckedUpdateInput });
    await this.audit(actorId, 'catalog.game.update', id, before, after);
    return after;
  }

  async remove(id: string, actorId: string) {
    const products = await this.prisma.product.count({ where: { gameId: id, deletedAt: null } });
    if (products > 0) throw new BadRequestException(`${products} product(s) still belong to this game`);

    await this.prisma.game.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    await this.audit(actorId, 'catalog.game.delete', id, null, null);
    return { message: 'Game deleted' };
  }

  /**
   * inputSchema drives the checkout form and is later matched against
   * OrderInput.fieldKey, which is unique per item — duplicate keys would
   * silently drop a field at fulfilment time.
   */
  private assertUniqueInputKeys(dto: CreateGameDto | UpdateGameDto) {
    if (!dto.inputSchema?.length) return;
    const keys = dto.inputSchema.map((f) => f.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException('inputSchema contains duplicate field keys');
    }
  }

  private audit(userId: string, action: string, entityId: string, before: unknown, after: unknown) {
    return this.prisma.auditLog.create({
      data: { userId, action, entityType: 'Game', entityId, before: before as any, after: after as any },
    });
  }
}
