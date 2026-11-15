import { ShopTemplatesService, WHATSAPP_TEMPLATES_KEY } from '../../src/modules/admin-tools/shop-templates.service';

describe('ShopTemplatesService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let service: ShopTemplatesService;

  beforeEach(() => {
    tx = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ShopTemplatesService(prisma, audit);
  });

  it('returns an empty list before any reply is saved', async () => {
    expect(await service.list()).toEqual([]);
  });

  it('keeps only well-formed entries of the stored list', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({
      value: [{ id: 't1', title: 'شكرًا', body: 'شكرًا {name}' }, { id: 2, title: 'x' }, 'junk', null, ['a']],
    });
    expect(await service.list()).toEqual([{ id: 't1', title: 'شكرًا', body: 'شكرًا {name}' }]);
  });

  it('ignores a stored value that is not a list', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: { id: 't1' } });
    expect(await service.list()).toEqual([]);
  });

  it('replaces the list as a private setting, keeping ids and giving new or repeated ones a fresh id', async () => {
    tx.systemSetting.findUnique.mockResolvedValue({ value: [{ id: 'old' }] });
    const res = await service.replace(
      [
        { id: 'keep', title: ' تم التسليم ', body: ' طلبك {order} جاهز: {link} ' },
        { title: 'جديد', body: 'مرحبًا {name}' },
        { id: 'keep', title: 'مكرر', body: 'b' },
      ],
      'admin-1',
    );
    expect(res[0]).toEqual({ id: 'keep', title: 'تم التسليم', body: 'طلبك {order} جاهز: {link}' });
    expect(res[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res[2].id).not.toBe('keep');

    const upsert = tx.systemSetting.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ key: WHATSAPP_TEMPLATES_KEY });
    expect(upsert.create).toMatchObject({ key: 'shop.whatsapp_templates', isPublic: false, group: 'shop' });
    expect(upsert.update.isPublic).toBe(false);
    expect(audit.record.mock.calls[0][1]).toMatchObject({ actorId: 'admin-1', action: 'shop.templates.update', before: [{ id: 'old' }] });
  });

  it('can empty the list', async () => {
    expect(await service.replace([], 'a')).toEqual([]);
    expect(audit.record.mock.calls[0][1].before).toBeNull();
  });
});
