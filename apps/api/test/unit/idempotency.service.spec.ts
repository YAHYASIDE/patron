import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdempotencyService } from '../../src/common/idempotency/idempotency.service';

describe('IdempotencyService', () => {
  let prisma: any;
  let crypto: any;
  let service: IdempotencyService;

  beforeEach(() => {
    prisma = {
      idempotencyRecord: {
        findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn(),
      },
    };
    crypto = { sha256: (v: string) => `hash(${v})` };
    service = new IdempotencyService(prisma, crypto);
  });

  it('lets a first-time key through', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.idempotencyRecord.create.mockResolvedValue({});

    await expect(service.claim('key-1', 'POST /orders', 'h1')).resolves.toBeNull();
  });

  it('replays the stored response for a completed key', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: 'h1', completedAt: new Date(), statusCode: 201, responseBody: { id: 'order-1' },
    });

    const result = await service.claim('key-1', 'POST /orders', 'h1');
    expect(result).toEqual({ replayed: true, statusCode: 201, body: { id: 'order-1' } });
  });

  it('rejects the same key with a different body — that is a bug, not a retry', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue({ requestHash: 'h1', completedAt: new Date() });
    await expect(service.claim('key-1', 'POST /orders', 'DIFFERENT')).rejects.toThrow(ConflictException);
  });

  it('blocks a concurrent request while the first is in flight', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: 'h1', completedAt: null, lockedAt: new Date(),
    });
    await expect(service.claim('key-1', 'POST /orders', 'h1')).rejects.toThrow(/still in progress/);
  });

  it('lets a retry through once a crashed request’s lock goes stale', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: 'h1', completedAt: null, lockedAt: new Date(Date.now() - 120_000),
    });
    prisma.idempotencyRecord.update.mockResolvedValue({});

    await expect(service.claim('key-1', 'POST /orders', 'h1')).resolves.toBeNull();
  });

  it('treats a lost create race as an in-flight duplicate, not a crash', async () => {
    prisma.idempotencyRecord.findUnique.mockResolvedValue(null);
    prisma.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(service.claim('key-1', 'POST /orders', 'h1')).rejects.toThrow(ConflictException);
  });

  it('releases the key on failure so a legitimate retry is possible', async () => {
    prisma.idempotencyRecord.deleteMany.mockResolvedValue({ count: 1 });
    await service.release('key-1');
    expect(prisma.idempotencyRecord.deleteMany).toHaveBeenCalledWith({
      where: { key: 'key-1', completedAt: null },
    });
  });
});
