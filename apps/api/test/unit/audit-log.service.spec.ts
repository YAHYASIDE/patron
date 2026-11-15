import { AuditLogService } from '../../src/modules/admin-tools/audit-log.service';
import { encodeCursor } from '../../src/common/dto/cursor.dto';

describe('AuditLogService', () => {
  let prisma: any;
  let service: AuditLogService;

  const row = (id: string, at: string, user: unknown = null) => ({
    id, action: 'coupons.update', entityType: 'Coupon', entityId: 'c1', createdAt: new Date(at), user,
  });

  beforeEach(() => {
    prisma = { auditLog: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new AuditLogService(prisma);
  });

  it('returns headline rows with the actor and a next cursor', async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      row('a2', '2026-10-19T10:00:00Z', { fullName: 'Owner', email: 'o@x.y' }),
      row('a1', '2026-10-19T09:00:00Z'),
    ]);
    const res = await service.list({ limit: 1, order: 'desc' } as any);
    expect(res.data).toEqual([
      { id: 'a2', action: 'coupons.update', entityType: 'Coupon', entityId: 'c1', createdAt: new Date('2026-10-19T10:00:00Z'), actor: { fullName: 'Owner', email: 'o@x.y' } },
    ]);
    expect(res.nextCursor).toBe(encodeCursor(new Date('2026-10-19T10:00:00Z'), 'a2'));
    expect(res.meta.hasMore).toBe(true);
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(2);
    // the snapshots are not part of the list
    expect(prisma.auditLog.findMany.mock.calls[0][0].select).not.toHaveProperty('before');
  });

  it('gives a null actor and cursor on the last page', async () => {
    prisma.auditLog.findMany.mockResolvedValue([row('a1', '2026-10-19T09:00:00Z')]);
    const res = await service.list({ limit: 20, order: 'desc' } as any);
    expect(res.data[0].actor).toBeNull();
    expect(res.nextCursor).toBeNull();
  });

  it('filters by entity type, action prefix and cursor', async () => {
    const cursor = encodeCursor(new Date('2026-10-19T10:00:00Z'), 'a2');
    await service.list({ limit: 20, order: 'desc', entityType: 'Product', action: 'catalog.', cursor } as any);
    const where = prisma.auditLog.findMany.mock.calls[0][0].where;
    expect(where.entityType).toBe('Product');
    expect(where.action).toEqual({ startsWith: 'catalog.' });
    expect(where.OR).toHaveLength(2);
  });
});
