import { ShopService, SUPPORT_WHATSAPP_KEY } from '../../src/modules/shop/shop.service';

describe('ShopService', () => {
  let prisma: any;
  let audit: any;
  let service: ShopService;

  beforeEach(() => {
    const tx = { systemSetting: { upsert: jest.fn().mockResolvedValue({}) } };
    prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ value: '+22222227268' }) },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
      tx,
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ShopService(prisma, audit);
  });

  it("returns the shop's WhatsApp number", async () => {
    expect(await service.info()).toEqual({ supportWhatsapp: '+22222227268' });
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { key: SUPPORT_WHATSAPP_KEY } });
  });

  it('reports none when the setting is missing or emptied', async () => {
    prisma.systemSetting.findUnique.mockResolvedValueOnce(null);
    expect(await service.info()).toEqual({ supportWhatsapp: null });
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: '' });
    expect(await service.info()).toEqual({ supportWhatsapp: null });
  });

  it('saves a new number as a public setting and audits it', async () => {
    await service.setInfo(' +22233445566 ', 'admin-1');
    const args = prisma.tx.systemSetting.upsert.mock.calls[0][0];
    expect(args.update).toEqual({ value: '+22233445566' });
    expect(args.create).toMatchObject({ isPublic: true, value: '+22233445566' });
    expect(audit.record.mock.calls[0][1]).toMatchObject({ actorId: 'admin-1', action: 'shop.info.update' });
  });
});
