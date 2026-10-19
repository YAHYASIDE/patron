import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { BannerDto } from './banners.dto';

const PUBLIC_FIELDS = {
  id: true, titleAr: true, subtitleAr: true, imageUrl: true, tone: true, linkType: true, linkValue: true,
} as const;

/** The offers the owner pins to the top of the store's home page. */
@Injectable()
export class BannersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** What the store shows now: active and inside its dates, in the owner's order. */
  listLive(now = new Date()) {
    return this.prisma.banner.findMany({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      select: PUBLIC_FIELDS,
      take: 10,
    });
  }

  listAll() {
    return this.prisma.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
  }

  async create(dto: BannerDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const banner = await tx.banner.create({ data: this.data(dto) });
      await this.audit.record(tx, { actorId, action: 'banners.create', entityType: 'Banner', entityId: banner.id, after: banner });
      return banner;
    });
  }

  async update(id: string, dto: BannerDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.banner.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Banner not found');
      const banner = await tx.banner.update({ where: { id }, data: this.data(dto) });
      await this.audit.record(tx, { actorId, action: 'banners.update', entityType: 'Banner', entityId: id, before, after: banner });
      return banner;
    });
  }

  async remove(id: string, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.banner.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Banner not found');
      await tx.banner.delete({ where: { id } });
      await this.audit.record(tx, { actorId, action: 'banners.delete', entityType: 'Banner', entityId: id, before });
    });
    return { deleted: true };
  }

  // a cleared optional field is stored as null, so the form can empty it
  private data(dto: BannerDto) {
    const linkType = dto.linkType || null;
    return {
      titleAr: dto.titleAr.trim(),
      subtitleAr: dto.subtitleAr?.trim() || null,
      imageUrl: dto.imageUrl?.trim() || null,
      tone: dto.tone ?? 'teal',
      linkType,
      linkValue: linkType && linkType !== 'offers' ? dto.linkValue?.trim() || null : null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    };
  }
}
