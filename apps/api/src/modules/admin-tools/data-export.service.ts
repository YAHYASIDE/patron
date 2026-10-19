import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { createdAtRange } from '../orders/dto/order.dto';
import { SOLD_STATUSES } from './customers-admin.service';
import { toCsv } from './csv';

/** A spreadsheet is not a database: past this many rows, narrow the dates. */
export const EXPORT_MAX_ROWS = 50_000;

/** Setting keys that could hold a credential are left out of the backup, whatever they are called later. */
const SECRET_SETTING = /secret|password|token|api[_-]?key|private/i;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * CSV exports (#39) and the full backup (#40).
 *
 * The backup is the owner's copy of the shop in case the free database goes
 * away. It holds what the shop is (customers, orders, catalogue, settings) and
 * none of what would let someone act as anyone: no password hashes, refresh
 * tokens, 2FA secrets, delivered or stocked code values, sensitive inputs,
 * raw gateway payloads or uploaded files. Every model is read with an explicit
 * `select`, so a column added later stays out until someone adds it here.
 */
@Injectable()
export class DataExportService {
  constructor(private prisma: PrismaService) {}

  async ordersCsv(from?: string, to?: string) {
    const createdAt = createdAtRange(from, to);
    const orders = await this.prisma.order.findMany({
      where: createdAt ? { createdAt } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_MAX_ROWS,
      select: {
        orderNumber: true, createdAt: true, status: true, total: true, currency: true,
        user: { select: { fullName: true, phone: true, email: true, country: true } },
        items: { select: { productNameAr: true, quantity: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1, select: { gateway: true } },
      },
    });

    const csv = toCsv(
      ['رقم الطلب', 'التاريخ', 'الحالة', 'العميل', 'الهاتف', 'الدولة', 'المنتجات', 'المجموع', 'العملة', 'طريقة الدفع'],
      orders.map((o) => [
        o.orderNumber,
        o.createdAt,
        o.status,
        o.user.fullName,
        o.user.phone ?? o.user.email,
        o.user.country,
        o.items.map((i) => `${i.productNameAr} × ${i.quantity}`).join(' | '),
        o.total.toString(),
        o.currency,
        o.payments[0]?.gateway ?? '',
      ]),
    );

    const span = from || to ? `${from ? from.slice(0, 10) : 'start'}-to-${to ? to.slice(0, 10) : iso(new Date())}` : iso(new Date());
    return { filename: `patron-orders-${span}.csv`, csv };
  }

  async customersCsv() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null, roles: { some: { role: { name: 'customer' } } } },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_MAX_ROWS,
      select: {
        id: true, fullName: true, phone: true, email: true, country: true, city: true,
        phoneVerifiedAt: true, createdAt: true, _count: { select: { orders: true } },
      },
    });

    const spent = users.length
      ? await this.prisma.order.groupBy({
          by: ['userId'],
          where: { userId: { in: users.map((u) => u.id) }, status: { in: [...SOLD_STATUSES] } },
          _sum: { totalBase: true },
        })
      : [];
    const byUser = new Map(spent.map((s) => [s.userId, s._sum.totalBase ?? new Prisma.Decimal(0)]));

    const csv = toCsv(
      ['الاسم', 'الهاتف', 'البريد', 'الدولة', 'المدينة', 'موثّق', 'الطلبات', 'المشتريات (USD)', 'تاريخ التسجيل'],
      users.map((u) => [
        u.fullName,
        u.phone,
        u.email,
        u.country,
        u.city,
        u.phoneVerifiedAt ? 'نعم' : 'لا',
        u._count.orders,
        (byUser.get(u.id) ?? new Prisma.Decimal(0)).toFixed(2),
        u.createdAt,
      ]),
    );
    return { filename: `patron-customers-${iso(new Date())}.csv`, csv };
  }

  async backup() {
    const [users, orders, products, prices, categories, games, banners, coupons, settings] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, email: true, phone: true, fullName: true, avatarUrl: true, locale: true, defaultCurrency: true,
          isActive: true, isBlocked: true, emailVerifiedAt: true, phoneVerifiedAt: true, twoFaEnabled: true,
          lastLoginAt: true, country: true, city: true, adminNote: true, tags: true,
          createdAt: true, updatedAt: true, deletedAt: true,
          roles: { select: { role: { select: { name: true } } } },
          wallets: { select: { currencyCode: true, balance: true } },
        },
      }),
      this.prisma.order.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, orderNumber: true, userId: true, status: true,
          subtotal: true, discount: true, fees: true, taxAmount: true, total: true,
          currency: true, baseCurrency: true, fxRate: true, totalBase: true, couponId: true,
          notes: true, adminNote: true, createdAt: true, updatedAt: true, paidAt: true, completedAt: true,
          items: {
            select: {
              id: true, productId: true, productNameAr: true, productNameEn: true, quantity: true,
              unitPrice: true, unitCost: true, lineTotal: true, status: true, createdAt: true, deliveredAt: true,
              inputs: { select: { fieldKey: true, fieldLabel: true, value: true, isSensitive: true } },
            },
          },
          payments: {
            select: {
              id: true, gateway: true, gatewayRef: true, amount: true, currency: true, amountBase: true, status: true,
              refundedAmount: true, failureReason: true, createdAt: true, capturedAt: true,
            },
          },
        },
      }),
      this.prisma.product.findMany({
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, sku: true, type: true, delivery: true, nameAr: true, nameEn: true, description: true, imageUrl: true,
          costPrice: true, sellPrice: true, discountPercent: true, currency: true, stockQty: true, lowStockAlert: true,
          maxPerOrder: true, isActive: true, isFeatured: true, sortOrder: true, metadata: true, etaMinutes: true,
          categoryId: true, gameId: true, createdAt: true, updatedAt: true, deletedAt: true,
        },
      }),
      this.prisma.productPrice.findMany({
        select: { productId: true, currencyCode: true, sellPrice: true, isActive: true },
      }),
      this.prisma.category.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.game.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } }),
      this.prisma.coupon.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.systemSetting.findMany({
        orderBy: { key: 'asc' },
        select: { key: true, value: true, group: true, description: true, isPublic: true, updatedAt: true },
      }),
    ]);

    const safeSettings = settings.filter((s) => !SECRET_SETTING.test(s.key));
    const safeOrders = orders.map((o) => ({
      ...o,
      items: o.items.map((i) => ({
        ...i,
        // sensitive inputs (passwords, PINs) are stored encrypted; the backup keeps only that one was given
        inputs: i.inputs.map((input) => ({ ...input, value: input.isSensitive ? null : input.value })),
      })),
    }));

    const exportedAt = new Date();
    return {
      filename: `patron-backup-${exportedAt.toISOString().slice(0, 19).replace(/:/g, '-')}.json`,
      body: {
        version: 1,
        exportedAt: exportedAt.toISOString(),
        counts: {
          users: users.length, orders: orders.length, products: products.length, prices: prices.length,
          categories: categories.length, games: games.length, banners: banners.length, coupons: coupons.length,
          settings: safeSettings.length,
        },
        users: users.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role.name) })),
        orders: safeOrders,
        products,
        prices,
        categories,
        games,
        banners,
        coupons,
        settings: safeSettings,
      },
    };
  }
}
