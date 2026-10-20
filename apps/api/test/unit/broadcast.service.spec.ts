import { BroadcastService } from '../../src/modules/admin-tools/broadcast.service';

describe('BroadcastService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: BroadcastService;

  const users = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));

  beforeEach(() => {
    tx = { notification: { createMany: jest.fn((a: any) => Promise.resolve({ count: a.data.length })) } };
    prisma = {
      user: { findMany: jest.fn().mockResolvedValue(users(3)) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new BroadcastService(prisma, audit);
  });

  it('writes one IN_APP notification per active customer, with French in data.fr', async () => {
    const res = await service.send(
      { titleAr: ' عرض ', bodyAr: 'خصم اليوم', titleFr: 'Offre', bodyFr: 'Remise du jour', link: '/products?offers=1' },
      'admin-1',
    );
    expect(res).toEqual({ sent: 3 });
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      deletedAt: null, isActive: true, isBlocked: false, roles: { some: { role: { name: 'customer' } } },
    });
    const rows = tx.notification.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      userId: 'u0', channel: 'IN_APP', titleAr: 'عرض', bodyAr: 'خصم اليوم',
      // no English given: it falls back to the French
      titleEn: 'Offre', bodyEn: 'Remise du jour',
      data: { type: 'broadcast', link: '/products?offers=1', fr: { title: 'Offre', body: 'Remise du jour' } },
    });
    expect(audit.record.mock.calls[0][1]).toMatchObject({
      actorId: 'admin-1', action: 'notifications.broadcast', after: { sent: 3, country: null, link: '/products?offers=1' },
    });
  });

  it('falls back to Arabic and sends no fr block without French', async () => {
    await service.send({ titleAr: 'عرض', bodyAr: 'نص', titleEn: 'Offer' }, 'a');
    const row = tx.notification.createMany.mock.calls[0][0].data[0];
    expect(row).toMatchObject({ titleEn: 'Offer', bodyEn: 'نص', data: { type: 'broadcast' } });
    expect(row.data).not.toHaveProperty('fr');
    expect(row.data).not.toHaveProperty('link');
  });

  it('fills a missing French title or body from the English one', async () => {
    await service.send({ titleAr: 'ع', bodyAr: 'ن', bodyFr: 'Corps', titleEn: 'Title' }, 'a');
    expect(tx.notification.createMany.mock.calls[0][0].data[0].data.fr).toEqual({ title: 'Title', body: 'Corps' });
  });

  it('can target one country', async () => {
    await service.send({ titleAr: 'ع', bodyAr: 'ن', country: 'MR' }, 'a');
    expect(prisma.user.findMany.mock.calls[0][0].where.country).toBe('MR');
  });

  it('writes in chunks of 1000 and reports the total', async () => {
    prisma.user.findMany.mockResolvedValue(users(2500));
    expect(await service.send({ titleAr: 'ع', bodyAr: 'ن' }, 'a')).toEqual({ sent: 2500 });
    expect(tx.notification.createMany.mock.calls.map((c: any[]) => c[0].data.length)).toEqual([1000, 1000, 500]);
  });

  it('sends nothing when nobody matches', async () => {
    prisma.user.findMany.mockResolvedValue([]);
    expect(await service.send({ titleAr: 'ع', bodyAr: 'ن' }, 'a')).toEqual({ sent: 0 });
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});
