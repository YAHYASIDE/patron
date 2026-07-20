import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';

describe('OutboxService', () => {
  let prisma: PrismaService;
  let outbox: OutboxService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    outbox = new OutboxService(prisma);
  });

  afterAll(() => prisma.$disconnect());
  beforeEach(() => prisma.outboxEvent.deleteMany());

  it('does not publish an event whose transaction rolled back', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await outbox.emit(tx, {
          aggregate: 'Order', aggregateId: 'o1', eventType: 'order.paid', payload: {},
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    const claimed = await outbox.claimBatch();
    expect(claimed).toHaveLength(0);
  });

  it('publishes an event whose transaction committed', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'o2', eventType: 'order.paid', payload: {} }),
    );

    const claimed = await outbox.claimBatch();
    expect(claimed).toHaveLength(1);
  });

  it('hands an event to only one concurrent relay', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'o3', eventType: 'order.paid', payload: {} }),
    );

    const [a, b] = await Promise.all([outbox.claimBatch(), outbox.claimBatch()]);
    expect(a.length + b.length).toBe(1);
  });

  it('backs off rather than hot-looping on failure', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'o4', eventType: 'x', payload: {} }),
    );
    const [event] = await outbox.claimBatch();
    await outbox.markFailed(event.id, 3, 'redis down');

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('PENDING');
    expect(row.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('parks a permanently failing event as DEAD instead of retrying forever', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'o5', eventType: 'x', payload: {} }),
    );
    const [event] = await outbox.claimBatch();
    await outbox.markFailed(event.id, 8, 'still broken');

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('DEAD');
  });
});
