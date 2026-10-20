import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Coupon, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateCouponDto, UpdateCouponDto } from './admin-tools.dto';

/** Coupons (#41): create, pause (isActive false) and see how often each was used. */
@Injectable()
export class CouponsAdminService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.coupon.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: { _count: { select: { orders: true } } },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, ordersCount: _count.orders }));
  }

  async create(dto: CreateCouponDto, actorId: string) {
    const data = this.data(dto);
    this.assertCoherent({ ...data, discountType: dto.discountType, discountValue: dto.discountValue });

    return this.prisma.$transaction(async (tx) => {
      if (await tx.coupon.findUnique({ where: { code: data.code! } })) throw this.duplicate();
      const coupon = await tx.coupon.create({ data: data as Prisma.CouponCreateInput });
      await this.audit.record(tx, { actorId, action: 'coupons.create', entityType: 'Coupon', entityId: coupon.id, after: coupon });
      return coupon;
    });
  }

  async update(id: string, dto: UpdateCouponDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.coupon.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Coupon not found');

      const data = this.data(dto);
      this.assertCoherent({ ...this.current(before), ...data });
      if (data.code && data.code !== before.code && (await tx.coupon.findUnique({ where: { code: data.code } }))) {
        throw this.duplicate();
      }

      const coupon = await tx.coupon.update({ where: { id }, data });
      await this.audit.record(tx, { actorId, action: 'coupons.update', entityType: 'Coupon', entityId: id, before, after: coupon });
      return coupon;
    });
  }

  /** Only the fields that were sent; an explicit null clears an optional limit or date. */
  private data(dto: UpdateCouponDto): Prisma.CouponUpdateInput & { code?: string } {
    const data: Prisma.CouponUpdateInput & { code?: string } = {};
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountValue !== undefined) data.discountValue = new Prisma.Decimal(dto.discountValue);
    if (dto.maxDiscount !== undefined) data.maxDiscount = dto.maxDiscount === null ? null : new Prisma.Decimal(dto.maxDiscount);
    if (dto.minOrderTotal !== undefined) data.minOrderTotal = dto.minOrderTotal === null ? null : new Prisma.Decimal(dto.minOrderTotal);
    if (dto.maxUses !== undefined) data.maxUses = dto.maxUses;
    if (dto.maxUsesPerUser !== undefined) data.maxUsesPerUser = dto.maxUsesPerUser;
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    return data;
  }

  private current(c: Coupon) {
    return { discountType: c.discountType, discountValue: c.discountValue, startsAt: c.startsAt, expiresAt: c.expiresAt };
  }

  /** The combined result (stored values plus the change) must make sense. */
  private assertCoherent(c: {
    discountType?: unknown; discountValue?: unknown; startsAt?: unknown; expiresAt?: unknown;
  }) {
    if (c.discountType === 'PERCENT' && c.discountValue !== undefined && new Prisma.Decimal(c.discountValue as Prisma.Decimal.Value).gt(100)) {
      throw new BadRequestException('A percent coupon cannot exceed 100%');
    }
    if (c.startsAt instanceof Date && c.expiresAt instanceof Date && c.expiresAt <= c.startsAt) {
      throw new BadRequestException('expiresAt must be after startsAt');
    }
  }

  private duplicate() {
    return new ConflictException({ message: 'A coupon with this code already exists', error: 'COUPON_CODE_TAKEN' });
  }
}
