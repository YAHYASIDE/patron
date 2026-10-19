import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { FeedbackService } from '../../src/modules/feedback/feedback.service';
import { EventsController, FeedbackAdminController } from '../../src/modules/feedback/feedback.controller';
import { PeriodQueryDto, ReportEventDto } from '../../src/modules/feedback/dto/feedback.dto';
import { reportServerError, setServerErrorSink } from '../../src/common/filters/server-error-sink';

describe('FeedbackService', () => {
  let prisma: any;
  let service: FeedbackService;

  beforeEach(() => {
    prisma = {
      storeEvent: {
        create: jest.fn().mockResolvedValue({ id: 'e1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    service = new FeedbackService(prisma);
  });

  afterEach(() => setServerErrorSink(null));

  describe('record', () => {
    it('keeps a search miss with its spaces collapsed and the signed-in customer', async () => {
      await expect(
        service.record({ kind: 'search_miss', value: 'free   fire  brasil', path: '/products' }, 'u1'),
      ).resolves.toEqual({ ok: true });
      expect(prisma.storeEvent.create.mock.calls[0][0].data).toEqual({
        kind: 'search_miss', value: 'free fire brasil', path: '/products', detail: undefined, userId: 'u1',
      });
    });

    it('keeps only the fields each kind uses, cut to size', async () => {
      await service.record({ kind: 'brand_view', value: 'g-pubg-mobile', detail: { title: 'ببجي', junk: 'x'.repeat(5000) } }, null);
      expect(prisma.storeEvent.create.mock.calls[0][0].data.detail).toEqual({ title: 'ببجي' });

      await service.record({ kind: 'suggestion', value: 'أضيفوا فري فاير البرازيل', detail: { contact: ' 22123456 ' } }, null);
      expect(prisma.storeEvent.create.mock.calls[1][0].data.detail).toEqual({ contact: '22123456' });

      await service.record(
        { kind: 'client_error', value: 'boom', detail: { app: 'evil', stack: 's'.repeat(3000), ua: 'Android' } },
        null,
      );
      const err = prisma.storeEvent.create.mock.calls[2][0].data.detail;
      expect(err.app).toBe('store');
      expect(err.stack).toHaveLength(1500);
      expect(err.ua).toBe('Android');

      await service.record({ kind: 'client_error', value: 'boom', detail: { app: 'admin' } }, null);
      expect(prisma.storeEvent.create.mock.calls[3][0].data.detail).toEqual({ app: 'admin' });
    });

    it('stores no detail when nothing useful is left', async () => {
      await service.record({ kind: 'search_miss', value: 'x', detail: { anything: 1 } }, null);
      await service.record({ kind: 'brand_view', value: 'g-x', detail: { title: '   ' } }, null);
      expect(prisma.storeEvent.create.mock.calls[0][0].data.detail).toBeUndefined();
      expect(prisma.storeEvent.create.mock.calls[1][0].data.detail).toBeUndefined();
      expect(prisma.storeEvent.create.mock.calls[1][0].data.path).toBeNull();
    });
  });

  describe('server errors', () => {
    const report = { message: 'DB down', method: 'GET', path: '/api/v1/orders', status: 500, correlationId: 'c1' };

    it('are recorded through the sink once the module starts, and the sink is removed on stop', async () => {
      service.onModuleInit();
      reportServerError(report);
      await new Promise((r) => setImmediate(r));
      expect(prisma.storeEvent.create.mock.calls[0][0].data).toEqual({
        kind: 'server_error', value: 'DB down', path: '/api/v1/orders',
        detail: { method: 'GET', status: 500, correlationId: 'c1' },
      });
      service.onModuleDestroy();
      reportServerError(report);
      await new Promise((r) => setImmediate(r));
      expect(prisma.storeEvent.create).toHaveBeenCalledTimes(1);
    });

    it('records one row per message a minute, and never throws when the database fails', async () => {
      await service.recordServerError(report, 1_000);
      await service.recordServerError(report, 30_000);
      await service.recordServerError({ ...report, message: '' }, 30_000);
      await service.recordServerError(report, 62_000);
      expect(prisma.storeEvent.create).toHaveBeenCalledTimes(3);
      expect(prisma.storeEvent.create.mock.calls[1][0].data.value).toBe('Unknown error');

      prisma.storeEvent.create.mockRejectedValueOnce(new Error('connection refused'));
      await expect(service.recordServerError({ ...report, message: 'other' }, 70_000)).resolves.toBeUndefined();
    });

    it('forgets old messages once it has seen many', async () => {
      for (let i = 0; i < 202; i++) await service.recordServerError({ ...report, message: `m${i}` }, 1_000);
      await service.recordServerError({ ...report, message: 'm0' }, 2_000);
      expect(prisma.storeEvent.create).toHaveBeenCalledTimes(203);
    });

    it('a sink that throws never reaches the request', () => {
      setServerErrorSink(() => {
        throw new Error('nope');
      });
      expect(() => reportServerError(report)).not.toThrow();
    });
  });

  describe('owner pages', () => {
    it('gathers the four opportunity lists for the period', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([{ query: 'free fire brasil', count: 3, lastAt: new Date('2026-10-19') }])
        .mockResolvedValueOnce([{ brandKey: 'g-pubg-mobile', title: 'ببجي', views: 9 }])
        .mockResolvedValueOnce([{ productId: 'p1', sku: 'TOP-PUBG-60', nameAr: 'ببجي 60', checkouts: 2, customers: 2, lastAt: new Date() }]);
      prisma.storeEvent.findMany.mockResolvedValue([
        { id: 's1', value: 'أضيفوا روبلوكس', detail: { contact: '22123456' }, createdAt: new Date(), user: null },
        { id: 's2', value: 'سبوتيفاي', detail: null, createdAt: new Date(), user: { id: 'u1', fullName: 'سيدي', phone: '+222' } },
      ]);

      const now = new Date('2026-10-19T12:00:00Z');
      const res = await service.opportunities(7, now);

      expect(res.days).toBe(7);
      expect(res.searchMisses[0].query).toBe('free fire brasil');
      expect(res.mostViewed[0].views).toBe(9);
      expect(res.abandoned[0].sku).toBe('TOP-PUBG-60');
      expect(res.suggestions).toEqual([
        expect.objectContaining({ id: 's1', text: 'أضيفوا روبلوكس', contact: '22123456', user: null }),
        expect.objectContaining({ id: 's2', text: 'سبوتيفاي', contact: null, user: { id: 'u1', fullName: 'سيدي', phone: '+222' } }),
      ]);
      expect(prisma.storeEvent.findMany.mock.calls[0][0].where).toEqual({
        kind: 'suggestion', createdAt: { gte: new Date('2026-10-12T12:00:00Z') },
      });
    });

    it('lists grouped errors for the period', async () => {
      prisma.$queryRaw.mockResolvedValue([{ source: 'server', message: 'DB down', count: 2 }]);
      await expect(service.errors(1, new Date())).resolves.toEqual([{ source: 'server', message: 'DB down', count: 2 }]);
      // the defaults use the current time
      await service.errors();
      await service.opportunities();
      expect(prisma.$queryRaw).toHaveBeenCalled();
    });
  });
});

describe('EventsController', () => {
  const feedback = { record: jest.fn().mockResolvedValue({ ok: true }) } as any;
  const jwt = { verifyAsync: jest.fn() } as any;
  const config = { getOrThrow: () => 'secret' } as any;
  const ctrl = new EventsController(feedback, jwt, config);
  const dto = { kind: 'search_miss' as const, value: 'roblox' };

  beforeEach(() => jest.clearAllMocks());

  it('links the event to the customer behind a valid access token', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', type: 'access' });
    await ctrl.report(dto, 'Bearer good');
    expect(jwt.verifyAsync).toHaveBeenCalledWith('good', { secret: 'secret' });
    expect(feedback.record).toHaveBeenCalledWith(dto, 'u1');
  });

  it('records anonymously without a token, with a bad one, or with another token type', async () => {
    await ctrl.report(dto);
    await ctrl.report(dto, 'Basic abc');
    jwt.verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await ctrl.report(dto, 'Bearer old');
    jwt.verifyAsync.mockResolvedValueOnce({ sub: 'u1', type: 'refresh' });
    await ctrl.report(dto, 'Bearer refresh');
    expect(feedback.record.mock.calls.map((c: unknown[]) => c[1])).toEqual([null, null, null, null]);
  });
});

describe('FeedbackAdminController', () => {
  it('passes the period, with 30 and 7 days by default', () => {
    const feedback = { opportunities: jest.fn(), errors: jest.fn() } as any;
    const ctrl = new FeedbackAdminController(feedback);
    void ctrl.opportunities({});
    void ctrl.opportunities({ days: 90 });
    void ctrl.errors({});
    void ctrl.errors({ days: 1 });
    expect(feedback.opportunities.mock.calls).toEqual([[30], [90]]);
    expect(feedback.errors.mock.calls).toEqual([[7], [1]]);
  });
});

describe('feedback DTOs', () => {
  const check = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('accepts the four kinds a visitor may report', async () => {
    for (const kind of ['search_miss', 'brand_view', 'suggestion', 'client_error'])
      expect(await check(ReportEventDto, { kind, value: 'x', path: '/a', detail: {} })).toEqual([]);
  });

  it('refuses server_error from outside, empty or long values, odd paths and non-object details', async () => {
    expect(await check(ReportEventDto, { kind: 'server_error', value: 'x' })).toEqual(['kind']);
    expect(await check(ReportEventDto, { kind: 'search_miss', value: '   ' })).toEqual(['value']);
    expect(await check(ReportEventDto, { kind: 'search_miss', value: 'x'.repeat(301) })).toEqual(['value']);
    expect(await check(ReportEventDto, { kind: 'search_miss', value: 'x', path: 'https://evil' })).toEqual(['path']);
    expect(await check(ReportEventDto, { kind: 'search_miss', value: 'x', detail: 'str' })).toEqual(['detail']);
  });

  it('allows only the offered periods', async () => {
    expect(await check(PeriodQueryDto, { days: '7' })).toEqual([]);
    expect(await check(PeriodQueryDto, { days: '5' })).toEqual(['days']);
  });
});
