import { NotFoundException } from '@nestjs/common';
import { BannersService } from '../../src/modules/banners/banners.service';
import { BannersAdminController, BannersController } from '../../src/modules/banners/banners.controller';

describe('BannersService', () => {
  let prisma: any;
  let audit: any;
  let service: BannersService;

  beforeEach(() => {
    const tx = {
      banner: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'b1', ...a.data })),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
        delete: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ id: 'b1', titleAr: 'قديم' }),
      },
    };
    prisma = {
      banner: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      tx,
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new BannersService(prisma, audit);
  });

  it('lists only active banners inside their dates, public fields only', async () => {
    const now = new Date('2026-10-19T10:00:00Z');
    await service.listLive(now);
    const args = prisma.banner.findMany.mock.calls[0][0];
    expect(args.where.isActive).toBe(true);
    expect(args.where.AND).toEqual([
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ]);
    expect(args.select).not.toHaveProperty('isActive');
    expect(args.orderBy[0]).toEqual({ sortOrder: 'asc' });
  });

  it('lists every banner for the dashboard', async () => {
    await service.listAll();
    expect(prisma.banner.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: expect.any(Array) }));
  });

  it('creates a text-only banner with defaults and audits it', async () => {
    const b = await service.create({ titleAr: '  عرض ببجي  ', subtitleAr: '', imageUrl: '' }, 'admin-1');
    expect(b).toMatchObject({
      titleAr: 'عرض ببجي', subtitleAr: null, imageUrl: null, tone: 'teal',
      linkType: null, linkValue: null, sortOrder: 0, isActive: true, startsAt: null, endsAt: null,
    });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ actorId: 'admin-1', action: 'banners.create', entityId: 'b1' });
  });

  it('keeps the link value for product/url links and drops it for the offers page', async () => {
    const p = await service.create({ titleAr: 'نتفلكس', linkType: 'product', linkValue: ' SUB-NETFLIX-1M ' }, 'a');
    expect(p).toMatchObject({ linkType: 'product', linkValue: 'SUB-NETFLIX-1M' });
    const o = await service.create({ titleAr: 'عروض', linkType: 'offers', linkValue: 'ignored' }, 'a');
    expect(o).toMatchObject({ linkType: 'offers', linkValue: null });
    const n = await service.create({ titleAr: 'بلا رابط', linkType: '', linkValue: 'x' }, 'a');
    expect(n).toMatchObject({ linkType: null, linkValue: null });
  });

  it('updates a banner with its dates and audits before/after', async () => {
    const b = await service.update(
      'b1',
      { titleAr: 'جديد', tone: 'gold', startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-10-27T00:00:00Z', isActive: false, sortOrder: 2 },
      'admin-1',
    );
    expect(b).toMatchObject({ titleAr: 'جديد', tone: 'gold', isActive: false, sortOrder: 2 });
    expect(b.startsAt).toEqual(new Date('2026-10-20T00:00:00Z'));
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'banners.update', before: { titleAr: 'قديم' } });
  });

  it('refuses to update or delete a missing banner', async () => {
    prisma.tx.banner.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { titleAr: 'xx' }, 'a')).rejects.toThrow(NotFoundException);
    await expect(service.remove('nope', 'a')).rejects.toThrow(NotFoundException);
  });

  it('deletes a banner and audits it', async () => {
    expect(await service.remove('b1', 'admin-1')).toEqual({ deleted: true });
    expect(prisma.tx.banner.delete).toHaveBeenCalledWith({ where: { id: 'b1' } });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ action: 'banners.delete' });
  });
});

describe('Banners controllers', () => {
  const banners = {
    listLive: jest.fn().mockReturnValue('live'),
    listAll: jest.fn().mockReturnValue('all'),
    create: jest.fn().mockReturnValue('created'),
    update: jest.fn().mockReturnValue('updated'),
    remove: jest.fn().mockReturnValue('removed'),
  } as any;

  it('serves the live banners publicly', () => {
    expect(new BannersController(banners).live()).toBe('live');
  });

  it('delegates admin CRUD with the acting user', () => {
    const c = new BannersAdminController(banners);
    const dto = { titleAr: 'عرض' };
    expect(c.list()).toBe('all');
    expect(c.create(dto, 'u1')).toBe('created');
    expect(banners.create).toHaveBeenCalledWith(dto, 'u1');
    expect(c.update('b1', dto, 'u1')).toBe('updated');
    expect(banners.update).toHaveBeenCalledWith('b1', dto, 'u1');
    expect(c.remove('b1', 'u1')).toBe('removed');
    expect(banners.remove).toHaveBeenCalledWith('b1', 'u1');
  });
});
