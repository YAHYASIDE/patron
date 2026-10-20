import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReviewsService, authorName } from '../../src/modules/reviews/reviews.service';
import { ReviewsAdminController, ReviewsController, ReviewsPublicController } from '../../src/modules/reviews/reviews.controller';

const ITEM = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const P2 = '55555555-5555-4555-8555-555555555555';

describe('authorName', () => {
  it('shows the first name and the initial of the last word', () => {
    expect(authorName('Mohamed Ahmed')).toBe('Mohamed A.');
    expect(authorName('  mohamed  ould  salem ')).toBe('mohamed S.');
    expect(authorName('محمد أحمد')).toBe('محمد أ.');
    expect(authorName('Aicha')).toBe('Aicha');
  });

  it('never shows a phone number', () => {
    expect(authorName('Sidi +22212345678')).toBe('Sidi');
    expect(authorName('+22212345678')).toBe('زبون');
    expect(authorName(null)).toBe('زبون');
    expect(authorName('Sidi 7a')).toBe('Sidi A.');
  });
});

describe('ReviewsService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: ReviewsService;

  beforeEach(() => {
    tx = {
      review: {
        findUnique: jest.fn().mockResolvedValue({ id: 'r1', isPublished: true, reply: null }),
        update: jest.fn((a: any) => Promise.resolve({ id: a.where.id, ...a.data })),
      },
    };
    prisma = {
      orderItem: {
        findFirst: jest.fn().mockResolvedValue({ id: ITEM, productId: P1, status: 'DELIVERED', review: null }),
      },
      review: {
        create: jest.fn((a: any) => Promise.resolve({ id: 'r1', ...a.data })),
        findMany: jest.fn().mockResolvedValue([]),
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.666 }, _count: { _all: 3 } }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ReviewsService(prisma, audit);
  });

  describe('create', () => {
    it('rates a delivered item the caller bought', async () => {
      const review = await service.create('u1', { orderItemId: ITEM, rating: 5, comment: '  ممتاز ' });
      expect(prisma.orderItem.findFirst.mock.calls[0][0].where).toEqual({ id: ITEM, order: { userId: 'u1' } });
      expect(prisma.review.create.mock.calls[0][0].data).toEqual({
        userId: 'u1', productId: P1, orderItemId: ITEM, rating: 5, comment: 'ممتاز',
      });
      expect(review).toMatchObject({ id: 'r1' });
      await service.create('u1', { orderItemId: ITEM, rating: 3, comment: '   ' });
      expect(prisma.review.create.mock.calls[1][0].data.comment).toBeNull();
    });

    it('refuses someone else\'s item, an undelivered one and a second review', async () => {
      prisma.orderItem.findFirst.mockResolvedValueOnce(null);
      await expect(service.create('u1', { orderItemId: ITEM, rating: 5 })).rejects.toThrow(NotFoundException);

      prisma.orderItem.findFirst.mockResolvedValueOnce({ id: ITEM, productId: P1, status: 'PENDING', review: null });
      await expect(service.create('u1', { orderItemId: ITEM, rating: 5 }))
        .rejects.toMatchObject({ response: expect.objectContaining({ error: 'NOT_DELIVERED' }) });

      prisma.orderItem.findFirst.mockResolvedValueOnce({ id: ITEM, productId: P1, status: 'DELIVERED', review: { id: 'r0' } });
      await expect(service.create('u1', { orderItemId: ITEM, rating: 5 }))
        .rejects.toMatchObject({ status: 409, response: expect.objectContaining({ error: 'ALREADY_REVIEWED' }) });
    });

    it('turns a race on the unique item into 409 and rethrows anything else', async () => {
      prisma.review.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      await expect(service.create('u1', { orderItemId: ITEM, rating: 4 })).rejects.toThrow(ConflictException);

      prisma.review.create.mockRejectedValueOnce(new Error('boom'));
      await expect(service.create('u1', { orderItemId: ITEM, rating: 4 })).rejects.toThrow('boom');
    });
  });

  it('lists the item ids the caller already reviewed', async () => {
    prisma.review.findMany.mockResolvedValue([{ orderItemId: 'a' }, { orderItemId: 'b' }]);
    await expect(service.reviewedItemIds('u1')).resolves.toEqual(['a', 'b']);
    expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  describe('forProducts', () => {
    it('summarises published reviews with a safe author name', async () => {
      const createdAt = new Date();
      prisma.review.findMany.mockResolvedValue([
        { id: 'r1', rating: 5, comment: 'top', reply: 'شكرًا', createdAt, user: { fullName: 'Mohamed Ahmed' } },
      ]);

      const res = await service.forProducts(` ${P1},${P2},${P1},nope`);

      expect(res).toEqual({
        average: 4.7, count: 3,
        items: [{ id: 'r1', rating: 5, comment: 'top', author: 'Mohamed A.', createdAt, reply: 'شكرًا' }],
      });
      const args = prisma.review.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ productId: { in: [P1, P2] }, isPublished: true });
      expect(args.take).toBe(20);
      expect(args.select.user.select).toEqual({ fullName: true });
    });

    it('answers empty for no valid id and null average for no review', async () => {
      await expect(service.forProducts('x,y')).resolves.toEqual({ average: null, count: 0, items: [] });
      expect(prisma.review.aggregate).not.toHaveBeenCalled();

      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });
      await expect(service.forProducts(P1)).resolves.toEqual({ average: null, count: 0, items: [] });
    });

    it('refuses more than 100 products', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
      await expect(service.forProducts(ids.join(','))).rejects.toThrow(BadRequestException);
    });
  });

  describe('owner', () => {
    it('lists reviews with product and customer name, filtered by visibility', async () => {
      prisma.review.findMany.mockResolvedValue([{ id: 'r1', user: { id: 'u1', fullName: 'Ali' }, product: { id: 'p1' } }]);
      await expect(service.listAdmin('false')).resolves.toEqual([
        { id: 'r1', customer: { id: 'u1', fullName: 'Ali' }, product: { id: 'p1' } },
      ]);
      expect(prisma.review.findMany.mock.calls[0][0].where).toEqual({ isPublished: false });
      await service.listAdmin('true');
      expect(prisma.review.findMany.mock.calls[1][0].where).toEqual({ isPublished: true });
      await service.listAdmin();
      expect(prisma.review.findMany.mock.calls[2][0].where).toEqual({});
      expect(prisma.review.findMany.mock.calls[2][0].select.user.select).not.toHaveProperty('phone');
    });

    it('hides and answers a review, auditing the change', async () => {
      const r = await service.update('r1', { isPublished: false, reply: '  نعتذر ' }, 'admin');
      expect(r).toMatchObject({ isPublished: false, reply: 'نعتذر' });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ actorId: 'admin', action: 'reviews.update', entityId: 'r1' }));
    });

    it('removes a reply with null or empty, and leaves untouched fields alone', async () => {
      await service.update('r1', { reply: null }, 'admin');
      expect(tx.review.update.mock.calls[0][0].data).toEqual({ reply: null });
      await service.update('r1', { reply: ' ' }, 'admin');
      expect(tx.review.update.mock.calls[1][0].data).toEqual({ reply: null });
      await service.update('r1', {}, 'admin');
      expect(tx.review.update.mock.calls[2][0].data).toEqual({});
    });

    it('refuses a missing review', async () => {
      tx.review.findUnique.mockResolvedValue(null);
      await expect(service.update('nope', { isPublished: true }, 'admin')).rejects.toThrow(NotFoundException);
    });
  });
});

describe('Reviews controllers', () => {
  const reviews: any = {
    forProducts: jest.fn().mockResolvedValue({ average: null, count: 0, items: [] }),
    create: jest.fn().mockResolvedValue({ id: 'r1' }),
    reviewedItemIds: jest.fn().mockResolvedValue(['i1']),
    listAdmin: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'r1' }),
  };

  it('route to the service', async () => {
    await new ReviewsPublicController(reviews).list({ productIds: 'a,b' });
    expect(reviews.forProducts).toHaveBeenCalledWith('a,b');

    const customer = new ReviewsController(reviews);
    await customer.create('u1', { orderItemId: ITEM, rating: 5 });
    expect(reviews.create).toHaveBeenCalledWith('u1', { orderItemId: ITEM, rating: 5 });
    await expect(customer.mine('u1')).resolves.toEqual(['i1']);

    const admin = new ReviewsAdminController(reviews);
    await admin.list({ published: 'true' });
    expect(reviews.listAdmin).toHaveBeenCalledWith('true');
    await admin.update('r1', { reply: 'ok' }, 'admin');
    expect(reviews.update).toHaveBeenCalledWith('r1', { reply: 'ok' }, 'admin');
  });
});
