import { StreamableFile } from '@nestjs/common';
import { PERMISSIONS_KEY } from '../../src/common/decorators/require-permissions.decorator';
import {
  AuditLogController, BroadcastController, CatalogToolsController, CouponsAdminController, CustomersAdminController,
  DataExportController, OrderNotesController, ShopTemplatesController,
} from '../../src/modules/admin-tools/admin-tools.controller';

const perms = (cls: { prototype: object }, method: string) =>
  Reflect.getMetadata(PERMISSIONS_KEY, (cls.prototype as Record<string, object>)[method]);

describe('admin-tools controllers', () => {
  it('customers: detail and patch delegate to the service', () => {
    const svc: any = { findOne: jest.fn(() => 'one'), update: jest.fn(() => 'upd'), setOrderNote: jest.fn(() => 'note') };
    const c = new CustomersAdminController(svc);
    expect(c.findOne('u1')).toBe('one');
    expect(c.update('u1', { tags: ['VIP'] }, 'a')).toBe('upd');
    expect(svc.update).toHaveBeenCalledWith('u1', { tags: ['VIP'] }, 'a');
    expect(new OrderNotesController(svc).setNote('o1', { note: 'x' }, 'a')).toBe('note');
    expect(svc.setOrderNote).toHaveBeenCalledWith('o1', { note: 'x' }, 'a');
  });

  describe('exports', () => {
    const res = () => ({ setHeader: jest.fn() }) as any;
    const exporter: any = {
      ordersCsv: jest.fn().mockResolvedValue({ filename: 'o.csv', csv: '﻿a\r\n' }),
      customersCsv: jest.fn().mockResolvedValue({ filename: 'c.csv', csv: '﻿b\r\n' }),
      backup: jest.fn().mockResolvedValue({ filename: 'b.json', body: Buffer.from('{"version":3}') }),
    };
    const c = new DataExportController(exporter);

    it('sends the orders CSV as an attachment', async () => {
      const r = res();
      expect(await c.orders({ from: '2026-10-01', to: '2026-10-19' }, r)).toBe('﻿a\r\n');
      expect(exporter.ordersCsv).toHaveBeenCalledWith('2026-10-01', '2026-10-19');
      expect(r.setHeader).toHaveBeenCalledWith('content-type', 'text/csv; charset=utf-8');
      expect(r.setHeader).toHaveBeenCalledWith('content-disposition', 'attachment; filename="o.csv"');
      expect(r.setHeader).toHaveBeenCalledWith('cache-control', 'no-store');
    });

    it('sends the customers CSV and the backup JSON', async () => {
      const r1 = res();
      expect(await c.customers(r1)).toBe('﻿b\r\n');
      expect(r1.setHeader).toHaveBeenCalledWith('content-disposition', 'attachment; filename="c.csv"');
      const r2 = res();
      const file = await c.backup(r2, 'owner-1');
      expect(file).toBeInstanceOf(StreamableFile);
      expect(file.options.length).toBe(13);
      expect(exporter.backup).toHaveBeenCalledWith('owner-1');
      expect(r2.setHeader).toHaveBeenCalledWith('content-type', 'application/json; charset=utf-8');
      expect(r2.setHeader).toHaveBeenCalledWith('content-disposition', 'attachment; filename="b.json"');
    });
  });

  it('coupons, templates, audit, broadcast and catalogue tools delegate', () => {
    const coupons: any = { list: jest.fn(() => 'l'), create: jest.fn(() => 'c'), update: jest.fn(() => 'u') };
    const cc = new CouponsAdminController(coupons);
    expect(cc.list()).toBe('l');
    expect(cc.create({ code: 'X1X', discountType: 'FIXED', discountValue: 1 }, 'a')).toBe('c');
    expect(cc.update('c1', { isActive: false }, 'a')).toBe('u');

    const templates: any = { list: jest.fn(() => 'tl'), replace: jest.fn(() => 'tr') };
    const tc = new ShopTemplatesController(templates);
    expect(tc.list()).toBe('tl');
    expect(tc.replace({ templates: [{ title: 't', body: 'b' }] }, 'a')).toBe('tr');
    expect(templates.replace).toHaveBeenCalledWith([{ title: 't', body: 'b' }], 'a');

    const log: any = { list: jest.fn(() => 'log') };
    expect(new AuditLogController(log).list({ limit: 20 } as any)).toBe('log');

    const broadcast: any = { send: jest.fn(() => ({ sent: 1 })) };
    expect(new BroadcastController(broadcast).send({ titleAr: 'ع', bodyAr: 'ن' }, 'a')).toEqual({ sent: 1 });

    const tools: any = { bulkPrice: jest.fn(() => 'bp'), clone: jest.fn(() => 'cl') };
    const tt = new CatalogToolsController(tools);
    expect(tt.bulkPrice({ percent: 5, dryRun: true }, 'a')).toBe('bp');
    expect(tt.clone('p1', 'a')).toBe('cl');
  });

  it('guards each route with the contract permission', () => {
    expect(perms(CustomersAdminController, 'findOne')).toEqual(['users.read']);
    expect(perms(CustomersAdminController, 'update')).toEqual(['users.write']);
    expect(perms(OrderNotesController, 'setNote')).toEqual(['orders.fulfil_manual']);
    expect(perms(DataExportController, 'orders')).toEqual(['reports.read']);
    expect(perms(DataExportController, 'customers')).toEqual(['users.read']);
    expect(perms(DataExportController, 'backup')).toEqual(['settings.manage']);
    for (const m of ['list', 'create', 'update']) expect(perms(CouponsAdminController, m)).toEqual(['coupons.manage']);
    for (const m of ['list', 'replace']) expect(perms(ShopTemplatesController, m)).toEqual(['settings.manage']);
    expect(perms(AuditLogController, 'list')).toEqual(['audit.read']);
    expect(perms(BroadcastController, 'send')).toEqual(['notifications.send']);
    expect(perms(CatalogToolsController, 'bulkPrice')).toEqual(['catalog.pricing']);
    expect(perms(CatalogToolsController, 'clone')).toEqual(['catalog.write']);
  });
});
