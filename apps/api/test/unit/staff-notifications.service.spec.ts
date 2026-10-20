import { StaffNotificationsService } from '../../src/modules/staff-notifications/staff-notifications.service';

describe('StaffNotificationsService', () => {
  const make = (upsert = jest.fn().mockResolvedValue({ id: 'n1' })) => {
    const prisma = { staffNotification: { upsert, updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    return { prisma, service: new StaffNotificationsService(prisma as never) };
  };

  it('keeps one live notice per subject, reopening it when raised again', async () => {
    const { prisma, service } = make();
    await service.notify({ type: 'order.failed', title: 'فشل', body: 'طلب', entityId: 'o1', priority: 'HIGH' });
    const arg = prisma.staffNotification.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ dedupeKey: 'order.failed:o1' });
    expect(arg.create).toMatchObject({ type: 'order.failed', priority: 'HIGH', dedupeKey: 'order.failed:o1' });
    expect(arg.update).toMatchObject({ resolvedAt: null, readAt: null });
  });

  it('never throws into the caller', async () => {
    const { service } = make(jest.fn().mockRejectedValue(new Error('db down')));
    await expect(service.notify({ type: 'x', title: 't', body: 'b', dedupeKey: 'k' })).resolves.toBeNull();
  });

  it('resolves only an open notice', async () => {
    const { prisma, service } = make();
    await service.resolve('order.failed:o1');
    expect(prisma.staffNotification.updateMany).toHaveBeenCalledWith({
      where: { dedupeKey: 'order.failed:o1', resolvedAt: null },
      data: { resolvedAt: expect.any(Date) },
    });
  });
});
