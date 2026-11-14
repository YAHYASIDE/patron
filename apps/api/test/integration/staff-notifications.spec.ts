import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { AuditService } from '../../src/common/audit/audit.service';
import { MAX_REMINDERS, StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';
import { StaffInboxService } from '../../src/modules/staff-notifications/staff-inbox.service';

/** The inbox on a real Postgres: dedupe on the unique key, reminders in place, muting per person. */
describe('Staff notifications (Postgres)', () => {
  let prisma: PrismaService;
  let staff: StaffNotificationsService;
  let inbox: StaffInboxService;
  let ownerId: string;
  let helperId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    staff = new StaffNotificationsService(prisma);
    inbox = new StaffInboxService(prisma, new AuditService(prisma));
  });

  afterAll(() => prisma.$disconnect());

  beforeEach(async () => {
    await prisma.currency.upsert({
      where: { code: 'USD' }, update: {},
      create: { code: 'USD', nameAr: 'دولار', nameEn: 'US Dollar', symbol: '$', isBase: true },
    });
    ownerId = (await prisma.user.create({ data: { email: `owner-${randomUUID()}@test.local`, fullName: 'Owner', passwordHash: 'x' } })).id;
    helperId = (await prisma.user.create({ data: { email: `helper-${randomUUID()}@test.local`, fullName: 'Helper', passwordHash: 'x' } })).id;
  });

  const failed = (orderId: string) => ({
    type: 'order.failed', priority: 'URGENT' as const, title: 'فشل', body: 'x', link: `/orders/${orderId}`,
    dedupeKey: `order.failed:${orderId}`, entityType: 'Order', entityId: orderId,
  });

  it('the same subject raised concurrently is one row', async () => {
    await Promise.all(Array.from({ length: 5 }, () => staff.notify(failed('o1'))));
    expect(await prisma.staffNotification.count()).toBe(1);
  });

  it('reminders re-raise in place, at most six times, and a resolved notice that comes back starts fresh', async () => {
    const n = await staff.notify(failed('o2'));
    await inbox.markRead(n!.id, ownerId);
    const t0 = n!.createdAt.getTime();

    expect(await staff.remind(new Date(t0 + 10 * 60_000))).toBe(0);
    for (let i = 1; i <= MAX_REMINDERS + 3; i++) await staff.remind(new Date(t0 + i * 16 * 60_000));

    const row = await prisma.staffNotification.findUniqueOrThrow({ where: { id: n!.id } });
    expect(row.remindCount).toBe(MAX_REMINDERS);
    expect(row.readAt).toBeNull();
    expect(await prisma.staffNotification.count()).toBe(1);

    await staff.resolve('order.failed:o2');
    expect(await staff.remind(new Date(t0 + 1000 * 60_000))).toBe(0);
    await staff.notify(failed('o2'));
    const back = await prisma.staffNotification.findUniqueOrThrow({ where: { id: n!.id } });
    expect(back).toMatchObject({ resolvedAt: null, remindCount: 0, lastRemindedAt: null });
  });

  it('HIGH waits 30 minutes; NORMAL is never reminded', async () => {
    const high = await staff.notify({ type: 'payment.pending', priority: 'HIGH', title: 't', body: 'b', dedupeKey: 'payment.pending:p1' });
    await staff.notify({ type: 'order.new', title: 't', body: 'b', dedupeKey: 'order.new:o1' });
    const t0 = high!.createdAt.getTime();
    expect(await staff.remind(new Date(t0 + 20 * 60_000))).toBe(0);
    expect(await staff.remind(new Date(t0 + 31 * 60_000))).toBe(1);
    expect(await staff.remind(new Date(t0 + 45 * 60_000))).toBe(0);
    expect(await staff.remind(new Date(t0 + 62 * 60_000))).toBe(1);
  });

  it('each person sees the inbox without the types they muted; resolving is shared', async () => {
    await staff.notify(failed('o3'));
    await staff.notify({ type: 'support.message', title: 't', body: 'b', dedupeKey: 'support.message:t1' });
    await inbox.setPrefs(helperId, ['support.message']);

    expect(await inbox.list(ownerId)).toMatchObject({ unread: 2, open: 2 });
    const helper = await inbox.list(helperId);
    expect(helper).toMatchObject({ unread: 1, open: 1 });
    expect(helper.data.map((d) => d.type)).toEqual(['order.failed']);
    expect(await inbox.prefs(helperId)).toEqual({ muted: ['support.message'] });

    await inbox.resolve(helper.data[0].id, helperId);
    expect(await inbox.list(ownerId)).toMatchObject({ unread: 1, open: 1 });
    expect((await inbox.list(ownerId, 'resolved')).data).toHaveLength(1);
    expect(await inbox.readAll(ownerId)).toEqual({ updated: 1 });
    expect(await inbox.list(ownerId)).toMatchObject({ unread: 0, open: 1 });
  });
});
