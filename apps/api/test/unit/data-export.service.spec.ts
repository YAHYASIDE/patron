import { Prisma } from '@prisma/client';
import { DataExportService } from '../../src/modules/admin-tools/data-export.service';
import { escapeCell, toCsv } from '../../src/modules/admin-tools/csv';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('csv', () => {
  it('starts with a BOM, ends lines with CRLF and keeps the header for an empty list', () => {
    expect(toCsv(['a', 'b'], [])).toBe('﻿a,b\r\n');
    expect(toCsv(['a'], [[1], [2]])).toBe('﻿a\r\n1\r\n2\r\n');
  });

  it('quotes, escapes formulas and normalises dates', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell('=HYPERLINK("x")')).toBe('"\t=HYPERLINK(""x"")"');
    expect(escapeCell('+22222123456')).toBe('\t+22222123456');
    expect(escapeCell(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19T00:00:00.000Z');
  });
});

describe('DataExportService', () => {
  let prisma: any;
  let backups: any;
  let service: DataExportService;

  beforeEach(() => {
    prisma = {
      order: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      productPrice: { findMany: jest.fn().mockResolvedValue([]) },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      game: { findMany: jest.fn().mockResolvedValue([]) },
      banner: { findMany: jest.fn().mockResolvedValue([]) },
      coupon: { findMany: jest.fn().mockResolvedValue([]) },
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    backups = { export: jest.fn() };
    service = new DataExportService(prisma, backups);
  });

  describe('ordersCsv', () => {
    it('writes one line per order with items, customer and payment method', async () => {
      prisma.order.findMany.mockResolvedValue([
        {
          orderNumber: 'PTN-1', createdAt: new Date('2026-10-19T08:00:00Z'), status: 'COMPLETED', total: D('398.0000'),
          currency: 'MRU',
          user: { fullName: 'Sidi', phone: '+22222123456', email: null, country: 'MR' },
          items: [{ productNameAr: 'ببجي 60', quantity: 2 }, { productNameAr: 'آيتونز', quantity: 1 }],
          payments: [{ gateway: 'MANUAL' }],
        },
        {
          orderNumber: 'PTN-2', createdAt: new Date('2026-10-19T09:00:00Z'), status: 'PENDING_PAYMENT', total: D(5),
          currency: 'USD',
          user: { fullName: 'Staff', phone: null, email: 'a@b.c', country: null },
          items: [], payments: [],
        },
      ]);
      const { filename, csv } = await service.ordersCsv('2026-10-01', '2026-10-19');
      expect(filename).toBe('patron-orders-2026-10-01-to-2026-10-19.csv');
      const lines = csv.replace('﻿', '').split('\r\n');
      expect(lines[0].split(',')).toHaveLength(10);
      expect(lines[1]).toBe('PTN-1,2026-10-19T08:00:00.000Z,COMPLETED,Sidi,\t+22222123456,MR,ببجي 60 × 2 | آيتونز × 1,398,MRU,MANUAL');
      expect(lines[2]).toBe('PTN-2,2026-10-19T09:00:00.000Z,PENDING_PAYMENT,Staff,a@b.c,,,5,USD,');
      const where = prisma.order.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(new Date('2026-10-01'));
      expect(where.createdAt.lt).toEqual(new Date('2026-10-20T00:00:00Z')); // a bare `to` includes the whole day
    });

    it('exports everything without dates, named after today', async () => {
      const { filename, csv } = await service.ordersCsv();
      expect(prisma.order.findMany.mock.calls[0][0].where).toEqual({});
      expect(filename).toMatch(/^patron-orders-\d{4}-\d{2}-\d{2}\.csv$/);
      expect(csv.startsWith('﻿رقم الطلب,')).toBe(true);
    });

    it('names an open-ended range', async () => {
      expect((await service.ordersCsv('2026-10-01T00:00:00Z')).filename).toMatch(/^patron-orders-2026-10-01-to-\d{4}-/);
      expect((await service.ordersCsv(undefined, '2026-10-05T23:59:59Z')).filename).toBe('patron-orders-start-to-2026-10-05.csv');
      expect(prisma.order.findMany.mock.calls[1][0].where.createdAt).toEqual({ lte: new Date('2026-10-05T23:59:59Z') });
    });
  });

  describe('customersCsv', () => {
    it('lists customers with their orders and spend', async () => {
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1', fullName: 'Aicha', phone: '+22233000000', email: null, country: 'MR', city: 'Nouadhibou',
          phoneVerifiedAt: new Date(), createdAt: new Date('2026-09-01T00:00:00Z'), _count: { orders: 4 },
        },
        {
          id: 'u2', fullName: 'Ali', phone: null, email: 'ali@x.y', country: null, city: null,
          phoneVerifiedAt: null, createdAt: new Date('2026-09-02T00:00:00Z'), _count: { orders: 0 },
        },
      ]);
      prisma.order.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { totalBase: D('12.345') } }]);
      const { filename, csv } = await service.customersCsv();
      expect(filename).toMatch(/^patron-customers-\d{4}-\d{2}-\d{2}\.csv$/);
      const lines = csv.replace('﻿', '').split('\r\n');
      expect(lines[1]).toBe('Aicha,\t+22233000000,,MR,Nouadhibou,نعم,4,12.35,2026-09-01T00:00:00.000Z');
      expect(lines[2]).toBe('Ali,,ali@x.y,,,لا,0,0.00,2026-09-02T00:00:00.000Z');
      expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({ deletedAt: null, roles: { some: { role: { name: 'customer' } } } });
    });

    it('skips the spend query when there are no customers', async () => {
      await service.customersCsv();
      expect(prisma.order.groupBy).not.toHaveBeenCalled();
    });

    it('treats a null spend sum as zero', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', fullName: 'A', phone: null, email: null, country: null, city: null, phoneVerifiedAt: null, createdAt: new Date(), _count: { orders: 1 } },
      ]);
      prisma.order.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { totalBase: null } }]);
      expect((await service.customersCsv()).csv).toContain(',1,0.00,');
    });
  });

  describe('backup', () => {
    it('hands out the full backup and remembers when it was downloaded', async () => {
      const body = { version: 2, exportedAt: '2026-10-20T08:15:30.000Z', counts: {}, tables: {} };
      backups.export.mockResolvedValue(body);

      const res = await service.backup();

      expect(res).toEqual({ filename: 'patron-backup-2026-10-20T08-15-30.json', body });
      expect(prisma.systemSetting.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { key: 'backup.last_downloaded_at' },
        update: { value: '2026-10-20T08:15:30.000Z' },
      }));
    });

    it('says when the last backup was downloaded, or null', async () => {
      prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: '2026-10-19T00:00:00.000Z' }).mockResolvedValueOnce(null);
      await expect(service.lastBackupAt()).resolves.toBe('2026-10-19T00:00:00.000Z');
      await expect(service.lastBackupAt()).resolves.toBeNull();
    });
  });
});
