import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { createdAtRange } from '../orders/dto/order.dto';
import { SOLD_STATUSES } from './customers-admin.service';
import { toCsv } from './csv';
import { BackupService } from './backup.service';

/** A spreadsheet is not a database: past this many rows, narrow the dates. */
export const EXPORT_MAX_ROWS = 50_000;

/** System setting holding when the owner last downloaded a full backup. */
export const LAST_BACKUP_KEY = 'backup.last_downloaded_at';

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * CSV exports (#39) and the full backup (#40).
 *
 * The backup is the owner's copy of the shop in case the free database goes
 * away; BackupService builds it and restores from it.
 */
@Injectable()
export class DataExportService {
  constructor(private prisma: PrismaService, private backups: BackupService) {}

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

  /**
   * The full backup (see BackupService for what it holds and leaves out).
   * The download time is remembered so the dashboard can remind the owner
   * when the last copy is getting old.
   */
  async backup() {
    const body = await this.backups.export();
    await this.prisma.systemSetting.upsert({
      where: { key: LAST_BACKUP_KEY },
      update: { value: body.exportedAt },
      create: { key: LAST_BACKUP_KEY, value: body.exportedAt, group: 'backup', description: 'When the owner last downloaded a full backup' },
    });
    return {
      filename: `patron-backup-${body.exportedAt.slice(0, 19).replace(/:/g, '-')}.json`,
      body,
    };
  }

  /** When the last full backup was downloaded (null: never). */
  async lastBackupAt(): Promise<string | null> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: LAST_BACKUP_KEY } });
    return typeof row?.value === 'string' ? row.value : null;
  }
}
