import { ReferenceService } from '../../src/common/reference/reference.service';

describe('ReferenceService', () => {
  let prisma: any;
  let service: ReferenceService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-23T12:00:00.000Z'));
    prisma = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 123n }]) };
    service = new ReferenceService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('builds an order number from the order sequence with the PTN prefix', async () => {
    const ref = await service.order();

    expect(ref).toBe('PTN-20260723-00000123');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT nextval('order_number_seq') AS nextval");
  });

  it('builds a quote number from the quote sequence with the QT prefix', async () => {
    const ref = await service.quote();

    expect(ref).toBe('QT-20260723-00000123');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT nextval('quote_number_seq') AS nextval");
  });

  it('builds a refund number from the refund sequence with the RF prefix', async () => {
    const ref = await service.refund();

    expect(ref).toBe('RF-20260723-00000123');
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith("SELECT nextval('refund_number_seq') AS nextval");
  });

  it('zero-pads the sequence value to eight digits', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ nextval: 7n }]);

    expect(await service.order()).toBe('PTN-20260723-00000007');
  });

  it('does not truncate a sequence value wider than eight digits', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ nextval: 123456789n }]);

    expect(await service.order()).toBe('PTN-20260723-123456789');
  });

  it('uses UTC date parts, zero-padding month and day', async () => {
    jest.setSystemTime(new Date('2026-01-05T23:30:00.000Z'));

    expect(await service.order()).toBe('PTN-20260105-00000123');
  });

  it('runs the query on the supplied tx client instead of the base prisma', async () => {
    const tx: any = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ nextval: 9n }]) };

    const ref = await service.order(tx);

    expect(ref).toBe('PTN-20260723-00000009');
    expect(tx.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
