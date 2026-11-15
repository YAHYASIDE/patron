import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';

/** Reviews shown on a brand page. */
const PUBLIC_LIMIT = 20;
/** A brand groups its amounts; more ids than this is not a brand page. */
const MAX_PRODUCT_IDS = 100;
const ADMIN_LIMIT = 200;

/**
 * "Mohamed Ahmed" → "Mohamed A.": the first name and the initial of the last
 * word. Only words with letters count, so a phone number typed into the name
 * never shows.
 */
export function authorName(fullName: string | null | undefined) {
  const words = (fullName ?? '').trim().split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (!words.length) return 'زبون';
  const first = words[0];
  if (words.length === 1) return first;
  const initial = Array.from(words[words.length - 1]).find((ch) => /\p{L}/u.test(ch));
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** Ratings after delivery (#15) and the owner's moderation (#42). */
@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Only the buyer, only a delivered item, once per item. */
  async create(userId: string, dto: CreateReviewDto) {
    const item = await this.prisma.orderItem.findFirst({
      where: { id: dto.orderItemId, order: { userId } },
      select: { id: true, productId: true, status: true, review: { select: { id: true } } },
    });
    if (!item) throw new NotFoundException('Order item not found');
    if (item.status !== 'DELIVERED') {
      throw new BadRequestException({ message: 'You can review an item once it is delivered', error: 'NOT_DELIVERED' });
    }
    if (item.review) throw this.alreadyReviewed();

    try {
      return await this.prisma.review.create({
        data: {
          userId,
          productId: item.productId,
          orderItemId: item.id,
          rating: dto.rating,
          comment: dto.comment?.trim() || null,
        },
        select: { id: true, orderItemId: true, productId: true, rating: true, comment: true, isPublished: true, createdAt: true },
      });
    } catch (err) {
      // two taps at once: the unique orderItemId decides
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw this.alreadyReviewed();
      throw err;
    }
  }

  async reviewedItemIds(userId: string) {
    const rows = await this.prisma.review.findMany({ where: { userId }, select: { orderItemId: true } });
    return rows.map((r) => r.orderItemId);
  }

  /** Published reviews of a brand's products: the average and the newest 20. */
  async forProducts(productIdsParam: string) {
    const ids = [...new Set(productIdsParam.split(',').map((id) => id.trim()).filter((id) => isUUID(id)))];
    if (!ids.length) return { average: null, count: 0, items: [] };
    if (ids.length > MAX_PRODUCT_IDS) throw new BadRequestException(`At most ${MAX_PRODUCT_IDS} products`);

    const where: Prisma.ReviewWhereInput = { productId: { in: ids }, isPublished: true };
    const [summary, rows] = await Promise.all([
      this.prisma.review.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
      this.prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: PUBLIC_LIMIT,
        select: { id: true, rating: true, comment: true, reply: true, createdAt: true, user: { select: { fullName: true } } },
      }),
    ]);

    const avg = summary._avg.rating;
    return {
      average: avg === null ? null : Math.round(avg * 10) / 10,
      count: summary._count._all,
      items: rows.map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        author: authorName(r.user.fullName),
        createdAt: r.createdAt,
        reply: r.reply,
      })),
    };
  }

  // ── owner ──

  listAdmin(published?: 'true' | 'false') {
    return this.prisma.review.findMany({
      where: published === undefined ? {} : { isPublished: published === 'true' },
      orderBy: { createdAt: 'desc' },
      take: ADMIN_LIMIT,
      select: {
        id: true, rating: true, comment: true, isPublished: true, reply: true, orderItemId: true,
        createdAt: true, updatedAt: true,
        product: { select: { id: true, sku: true, nameAr: true, nameEn: true } },
        user: { select: { id: true, fullName: true } },
      },
    }).then((rows) => rows.map(({ user, ...row }) => ({ ...row, customer: user })));
  }

  /** Hide/show a review and answer it; an empty reply removes the answer. */
  async update(id: string, dto: UpdateReviewDto, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.review.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Review not found');

      const data: Prisma.ReviewUpdateInput = {
        ...(dto.isPublished !== undefined && { isPublished: dto.isPublished }),
        ...(dto.reply !== undefined && { reply: dto.reply?.trim() || null }),
      };
      const after = await tx.review.update({ where: { id }, data });
      await this.audit.record(tx, { actorId, action: 'reviews.update', entityType: 'Review', entityId: id, before, after });
      return after;
    });
  }

  private alreadyReviewed() {
    return new ConflictException({ message: 'This item is already reviewed', error: 'ALREADY_REVIEWED' });
  }
}
