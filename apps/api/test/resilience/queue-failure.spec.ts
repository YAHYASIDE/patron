import { PrismaService } from '../../src/common/prisma/prisma.service';
import { OutboxService } from '../../src/common/outbox/outbox.service';

/**
 * Queue failure and recovery.
 *
 * The outbox exists precisely so that Redis being down degrades *latency*, not
 * correctness. These tests hold that line.
 */
describe('Queue failure', () => {
  let prisma: PrismaService;
  let outbox: OutboxService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    outbox = new OutboxService(prisma);
  });

  afterAll(() => prisma.$disconnect());
  beforeEach(() => prisma.outboxEvent.deleteMany());

  it('retains events while the queue is unreachable, then drains', async () => {
    for (let i = 0; i < 20; i++) {
      await prisma.$transaction((tx) =>
        outbox.emit(tx, { aggregate: 'Order', aggregateId: `o${i}`, eventType: 'order.paid', payload: {} }),
      );
    }

    // Redis is down: every publish fails.
    const claimed = await outbox.claimBatch(20);
    for (const event of claimed) await outbox.markFailed(event.id, 1, 'ECONNREFUSED');

    expect(await prisma.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(20);
    expect(await prisma.outboxEvent.count({ where: { status: 'DEAD' } })).toBe(0);

    // Redis recovers; backoff has elapsed.
    await prisma.outboxEvent.updateMany({ data: { availableAt: new Date(Date.now() - 1000) } });
    const redelivered = await outbox.claimBatch(50);
    for (const event of redelivered) await outbox.markPublished(event.id);

    expect(await prisma.outboxEvent.count({ where: { status: 'PENDING' } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { status: 'PUBLISHED' } })).toBe(20);
  });

  it('backs off exponentially rather than hammering a downed queue', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'b1', eventType: 'x', payload: {} }),
    );
    const [event] = await outbox.claimBatch();

    const delays: number[] = [];
    for (const attempt of [1, 2, 3, 4]) {
      const before = Date.now();
      await outbox.markFailed(event.id, attempt, 'down');
      const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
      delays.push(row.availableAt.getTime() - before);
    }

    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1]);
  });

  it('caps backoff so a recovered queue is not stuck waiting hours', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'c1', eventType: 'x', payload: {} }),
    );
    const [event] = await outbox.claimBatch();

    const before = Date.now();
    await outbox.markFailed(event.id, 7, 'down');
    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });

    expect(row.availableAt.getTime() - before).toBeLessThanOrEqual(300_000 + 1_000);
  });

  it('never hands one event to two concurrent relays under load', async () => {
    for (let i = 0; i < 200; i++) {
      await prisma.$transaction((tx) =>
        outbox.emit(tx, { aggregate: 'Order', aggregateId: `p${i}`, eventType: 'x', payload: {} }),
      );
    }

    const relays = await Promise.all(Array.from({ length: 6 }, () => outbox.claimBatch(50)));
    const ids = relays.flat().map((e) => e.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('parks a poisoned event as DEAD instead of blocking the queue forever', async () => {
    await prisma.$transaction((tx) =>
      outbox.emit(tx, { aggregate: 'Order', aggregateId: 'poison', eventType: 'x', payload: {} }),
    );
    const [event] = await outbox.claimBatch();
    await outbox.markFailed(event.id, 8, 'permanently malformed');

    const row = await prisma.outboxEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(row.status).toBe('DEAD');

    // A dead event must not be re-claimed and block the relay.
    expect(await outbox.claimBatch()).toHaveLength(0);
  });
});
