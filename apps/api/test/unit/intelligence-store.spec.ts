import { randomUUID } from 'crypto';

import { DiscoveriesStore, criticalKey } from '../../src/modules/intelligence/discoveries.store';
import { DiscoveryInput } from '../../src/modules/intelligence/intelligence.types';

const NOW = new Date('2026-10-20T03:17:00.000Z');

const input = (over: Partial<DiscoveryInput> = {}): DiscoveryInput => ({
  fingerprint: 'payments.account-no-number:test',
  kind: 'payment',
  title: 'حساب مفعّل بلا رقم',
  description: 'وصف',
  evidence: [{ type: 'db', ref: 'system_settings:payments.manual_accounts' }],
  confidence: 90,
  verified: true,
  severity: 'MEDIUM',
  impact: 'أثر',
  proposal: 'مقترح',
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(), fingerprint: 'payments.account-no-number:test', kind: 'payment', title: 't', description: 'd',
  evidence: [], confidence: 90, verified: true, severity: 'MEDIUM', impact: 'i', proposal: 'p', status: 'NEW',
  source: 'scanner:x', testResults: null, branch: null, prUrl: null, seenCount: 1, firstSeenAt: NOW, lastSeenAt: NOW,
  deferredUntil: null, createdAt: NOW, updatedAt: NOW, ...over,
});

describe('DiscoveriesStore', () => {
  let prisma: any;
  let tx: any;
  let staff: any;
  let store: DiscoveriesStore;
  let created: ReturnType<typeof row>;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      discovery: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn((a: any) => Promise.resolve(row({ ...a.data, seenCount: 2 }))),
      },
    };
    prisma = {
      discovery: {
        findUnique: jest.fn().mockResolvedValue(null),
        createMany: jest.fn((a: any) => {
          created = row(a.data[0]);
          return Promise.resolve({ count: 1 });
        }),
        findUniqueOrThrow: jest.fn(() => Promise.resolve(created)),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    staff = { notify: jest.fn().mockResolvedValue(null), resolve: jest.fn().mockResolvedValue(undefined) };
    store = new DiscoveriesStore(prisma, staff);
  });

  const existing = (over: Record<string, unknown>) => {
    const before = row(over);
    prisma.discovery.findUnique.mockResolvedValue({ id: before.id });
    tx.discovery.findUniqueOrThrow.mockResolvedValue(before);
    return before;
  };

  it('creates a new subject as NEW with seenCount 1, scrubbed', async () => {
    const phone = `+222${String(Date.now()).slice(-8)}`;
    const res = await store.upsert(input({ title: `appel ${phone}`, evidence: [{ type: 'log', ref: phone }] }), 'qa-tester', NOW);
    expect(res.created).toBe(true);
    const data = prisma.discovery.createMany.mock.calls[0][0].data[0];
    expect(data).toMatchObject({ status: 'NEW', seenCount: 1, source: 'qa-tester', firstSeenAt: NOW, lastSeenAt: NOW });
    expect(JSON.stringify(data)).not.toContain(phone);
    expect(staff.notify).not.toHaveBeenCalled();
  });

  it('clamps confidence and stores testResults when given', async () => {
    await store.upsert(input({ confidence: 140.4, testResults: { passed: 3 } }), 'ci', NOW);
    expect(prisma.discovery.createMany.mock.calls[0][0]).toMatchObject({ data: [{ confidence: 100, testResults: { passed: 3 } }], skipDuplicates: true });
  });

  it('a new CRITICAL discovery raises one urgent Arabic notice linked to it', async () => {
    const res = await store.upsert(input({ severity: 'CRITICAL' }), 'security-guardian', NOW);
    expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'intel.critical',
      priority: 'URGENT',
      link: `/intelligence?d=${res.discovery.id}`,
      dedupeKey: `intel.critical:${res.discovery.id}`,
      entityType: 'Discovery',
      entityId: res.discovery.id,
    }));
    expect(staff.notify.mock.calls[0][0].title).toMatch(/^اكتشاف حرج/);
  });

  it('seen again: keeps the status, bumps seenCount, moves lastSeenAt, takes the newer evidence', async () => {
    existing({ status: 'APPROVED' });
    const res = await store.upsert(input({ evidence: [{ type: 'log', ref: 'newer' }] }), 'scanner:x', NOW);
    expect(res.created).toBe(false);
    const data = tx.discovery.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'APPROVED', seenCount: { increment: 1 }, lastSeenAt: NOW, evidence: [{ type: 'log', ref: 'newer' }] });
    expect(data.testResults).toBeUndefined();
    expect(tx.$queryRaw).toHaveBeenCalled(); // row lock
  });

  it.each(['DONE', 'REJECTED'])('a %s discovery seen again is not reopened: testResults.reappeared is set', async (status) => {
    existing({ status, severity: 'CRITICAL', testResults: { passed: 1 } });
    await store.upsert(input({ severity: 'CRITICAL' }), 'scanner:x', NOW);
    const data = tx.discovery.update.mock.calls[0][0].data;
    expect(data.status).toBe(status);
    expect(data.testResults).toEqual({ passed: 1, reappeared: true, reappearedAt: NOW.toISOString() });
    expect(staff.notify).not.toHaveBeenCalled();
  });

  it('a deferral still running is respected', async () => {
    existing({ status: 'DEFERRED', deferredUntil: new Date(NOW.getTime() + 86_400_000) });
    await store.upsert(input({ severity: 'CRITICAL' }), 'scanner:x', NOW);
    const data = tx.discovery.update.mock.calls[0][0].data;
    expect(data.status).toBe('DEFERRED');
    expect(data.deferredUntil).toBeUndefined();
    expect(staff.notify).not.toHaveBeenCalled();
  });

  it('a deferral that ran out goes back to review', async () => {
    existing({ status: 'DEFERRED', deferredUntil: new Date(NOW.getTime() - 1000) });
    await store.upsert(input(), 'scanner:x', NOW);
    expect(tx.discovery.update.mock.calls[0][0].data).toMatchObject({ status: 'PENDING_REVIEW', deferredUntil: null });
  });

  it('newly CRITICAL raises the notice; already CRITICAL does not raise it again', async () => {
    const before = existing({ status: 'PENDING_REVIEW', severity: 'HIGH' });
    tx.discovery.update.mockResolvedValueOnce(row({ id: before.id, status: 'PENDING_REVIEW', severity: 'CRITICAL' }));
    await store.upsert(input({ severity: 'CRITICAL' }), 'scanner:x', NOW);
    expect(staff.notify).toHaveBeenCalledTimes(1);

    existing({ status: 'PENDING_REVIEW', severity: 'CRITICAL' });
    tx.discovery.update.mockResolvedValueOnce(row({ status: 'PENDING_REVIEW', severity: 'CRITICAL' }));
    await store.upsert(input({ severity: 'CRITICAL' }), 'scanner:x', NOW);
    expect(staff.notify).toHaveBeenCalledTimes(1);
  });

  it('two writers creating the same subject: the one whose insert did nothing lands on the update path', async () => {
    const winner = row();
    prisma.discovery.createMany.mockResolvedValueOnce({ count: 0 });
    prisma.discovery.findUniqueOrThrow.mockResolvedValueOnce(winner);
    tx.discovery.findUniqueOrThrow.mockResolvedValue(winner);
    const res = await store.upsert(input({ severity: 'CRITICAL' }), 'a', NOW);
    expect(res.created).toBe(false);
    expect(tx.discovery.update).toHaveBeenCalledTimes(1);
    expect(tx.discovery.update.mock.calls[0][0].where).toEqual({ id: winner.id });
  });

  it('database errors are not swallowed', async () => {
    prisma.discovery.createMany.mockRejectedValueOnce(new Error('db down'));
    await expect(store.upsert(input(), 'a', NOW)).rejects.toThrow('db down');
  });

  it('resolveCritical closes the notice and never throws', async () => {
    await store.resolveCritical('d1');
    expect(staff.resolve).toHaveBeenCalledWith(criticalKey('d1'), undefined);
    staff.resolve.mockRejectedValueOnce(new Error('x'));
    await expect(store.resolveCritical('d1')).resolves.toBeUndefined();
  });
});
