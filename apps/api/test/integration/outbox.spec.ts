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
    const event = await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'o3', eventType: 'order.paid', payload: {} }),
    );

    // Relay A holds the event's row lock inside an open transaction; relay B
    // then runs the real claim. SKIP LOCKED must make B come away empty — the
    // event is being processed by A. Holding the lock open makes this
    // deterministic rather than a `Promise.all` scheduling race.
    const holder = new PrismaService();
    await holder.$connect();
    try {
      let markLocked!: () => void;
      const locked = new Promise<void>((resolve) => (markLocked = resolve));
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));

      const holderTxn = holder.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "outbox_events" WHERE "id" = ${event.id}::uuid FOR UPDATE`;
          markLocked();
          await held;
        },
        { timeout: 20_000 },
      );

      await locked; // A genuinely holds the row lock before B tries to claim it
      const claimed = await outbox.claimBatch();
      release();
      await holderTxn;

      expect(claimed).toHaveLength(0);
    } finally {
      await holder.$disconnect();
    }
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
