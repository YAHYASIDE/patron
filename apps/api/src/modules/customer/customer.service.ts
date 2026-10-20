import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { SaveInputDto } from './dto/customer.dto';

/** Saved account values kept per game; the oldest go once a game has more. */
export const MAX_SAVED_PER_GAME = 10;
/** A generous cap so the favourites table cannot be filled by a script. */
export const MAX_FAVORITES = 200;
/** How the store groups products into brands (lib/brands.ts brandKey). */
export const BRAND_KEY = /^[a-z0-9-]{2,60}$/;
const MAX_VALUE_LENGTH = 200;

interface InputField {
  key: string;
  type?: string;
  sensitive?: boolean;
}

const SAVED_FIELDS = { id: true, gameId: true, label: true, values: true, updatedAt: true } satisfies Prisma.SavedInputSelect;

/** Same values regardless of key order, so `{a,b}` and `{b,a}` are one entry. */
function sameValues(a: Prisma.JsonValue, b: Record<string, string>) {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * The signed-in customer's own conveniences: account IDs saved per game,
 * favourite brands and every delivered code in one list.
 */
@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  // ── saved account IDs (#8) ──

  listSavedInputs(userId: string, gameId?: string) {
    return this.prisma.savedInput.findMany({
      where: { userId, ...(gameId && { gameId }) },
      orderBy: { updatedAt: 'desc' },
      select: SAVED_FIELDS,
    });
  }

  /**
   * Only the game's own, non-sensitive fields are kept: a password typed at
   * checkout must never end up stored in clear here.
   */
  async saveInput(userId: string, dto: SaveInputDto) {
    const game = await this.prisma.game.findFirst({
      where: { id: dto.gameId, deletedAt: null },
      select: { inputSchema: true },
    });
    if (!game) throw new NotFoundException('Game not found');

    const schema = Array.isArray(game.inputSchema) ? (game.inputSchema as unknown as InputField[]) : [];
    const allowed = new Set(
      schema.filter((f) => f.key && !f.sensitive && f.type !== 'password').map((f) => f.key),
    );

    const values: Record<string, string> = {};
    for (const [key, raw] of Object.entries(dto.values)) {
      if (!allowed.has(key) || typeof raw !== 'string') continue;
      const value = raw.trim();
      if (!value) continue;
      if (value.length > MAX_VALUE_LENGTH) throw new BadRequestException(`${key} is too long`);
      values[key] = value;
    }
    if (!Object.keys(values).length) {
      throw new BadRequestException({ message: 'Nothing to save for this game', error: 'NOTHING_TO_SAVE' });
    }
    const label = dto.label?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.savedInput.findMany({
        where: { userId, gameId: dto.gameId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, values: true, label: true },
      });

      const same = existing.find((row) => sameValues(row.values, values));
      if (same) {
        // Used again: it moves to the top, and keeps its label unless a new one is given.
        return tx.savedInput.update({
          where: { id: same.id },
          data: { updatedAt: new Date(), ...(label && { label }) },
          select: SAVED_FIELDS,
        });
      }

      const created = await tx.savedInput.create({
        data: { userId, gameId: dto.gameId, label, values },
        select: SAVED_FIELDS,
      });
      const overflow = existing.slice(MAX_SAVED_PER_GAME - 1).map((row) => row.id);
      if (overflow.length) await tx.savedInput.deleteMany({ where: { id: { in: overflow } } });
      return created;
    });
  }

  async deleteSavedInput(userId: string, id: string) {
    const { count } = await this.prisma.savedInput.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Saved account not found');
    return { deleted: true as const };
  }

  // ── favourites (#6) ──

  async listFavorites(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { brandKey: true },
    });
    return rows.map((r) => r.brandKey);
  }

  async addFavorite(userId: string, brandKey: string) {
    if (!BRAND_KEY.test(brandKey)) throw new BadRequestException('Invalid brand key');
    const count = await this.prisma.favorite.count({ where: { userId } });
    if (count >= MAX_FAVORITES) {
      throw new BadRequestException({ message: 'Too many favourites', error: 'TOO_MANY_FAVORITES' });
    }
    await this.prisma.favorite.upsert({
      where: { userId_brandKey: { userId, brandKey } },
      create: { userId, brandKey },
      update: {},
    });
    return { brandKey };
  }

  async removeFavorite(userId: string, brandKey: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, brandKey } });
    return { deleted: true as const };
  }

  // ── my codes (#5) ──

  /**
   * Every delivered item with what it holds, newest first. Values stay
   * encrypted here; the store reveals one with POST /orders/items/:id/reveal,
   * which is audited.
   */
  async myCodes(userId: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { status: 'DELIVERED', order: { userId }, results: { some: {} } },
      orderBy: [{ deliveredAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
      select: {
        id: true, productId: true, productNameAr: true, productNameEn: true, quantity: true, deliveredAt: true,
        order: { select: { id: true, orderNumber: true } },
        results: { select: { id: true, resultType: true, viewedAt: true }, orderBy: { deliveredAt: 'asc' } },
      },
    });

    return items.map((item) => ({
      orderId: item.order.id,
      orderNumber: item.order.orderNumber,
      itemId: item.id,
      productId: item.productId,
      productNameAr: item.productNameAr,
      productNameEn: item.productNameEn,
      quantity: item.quantity,
      deliveredAt: item.deliveredAt,
      results: item.results.map((r) => ({ id: r.id, resultType: r.resultType, revealed: r.viewedAt !== null })),
    }));
  }
}
