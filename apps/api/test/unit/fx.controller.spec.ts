import { FxController } from '../../src/modules/fx/fx.controller';

describe('FxController', () => {
  let fx: any;
  let controller: FxController;

  beforeEach(() => {
    fx = {
      history: jest.fn().mockReturnValue([{ id: 'r1' }]),
      findStale: jest.fn().mockResolvedValue(['EUR', 'GBP']),
      recordRate: jest.fn().mockResolvedValue({ id: 'r2' }),
      setManual: jest.fn().mockResolvedValue({ id: 'r2' }),
      overview: jest.fn().mockResolvedValue([{ code: 'MRU' }]),
    };
    controller = new FxController(fx);
  });

  it('normalises the currency to upper case when reading history', () => {
    const res = controller.history({ currency: 'eur' });
    expect(fx.history).toHaveBeenCalledWith('EUR');
    expect(res).toEqual([{ id: 'r1' }]);
  });

  it('wraps the stale currency list under a stale key', async () => {
    const res = await controller.stale();
    expect(fx.findStale).toHaveBeenCalled();
    expect(res).toEqual({ stale: ['EUR', 'GBP'] });
  });

  it("records the owner's rate under the acting operator with an upper-cased currency", async () => {
    const res = await controller.record({ currency: 'gbp' }, { rate: 0.8 }, 'admin-1');
    expect(fx.setManual).toHaveBeenCalledWith('GBP', 0.8, 'admin-1', false);
    expect(res).toEqual({ id: 'r2' });
    await controller.record({ currency: 'mru' }, { rate: 52, confirm: true }, 'admin-1');
    expect(fx.setManual).toHaveBeenLastCalledWith('MRU', 52, 'admin-1', true);
  });

  it('lists the currencies with their current rates', async () => {
    await expect(controller.overview()).resolves.toEqual([{ code: 'MRU' }]);
  });

  it('validates the currency and the rate', async () => {
    const { validate } = await import('class-validator');
    const { plainToInstance } = await import('class-transformer');
    const { CurrencyParamDto, RecordRateDto } = await import('../../src/modules/fx/dto/fx.dto');
    const errs = async (cls: any, body: object) => (await validate(plainToInstance(cls, body))).map((e) => e.property);
    expect(await errs(CurrencyParamDto, { currency: 'mru' })).toEqual([]);
    expect(await errs(CurrencyParamDto, { currency: 'status' })).toEqual(['currency']);
    expect(await errs(RecordRateDto, { rate: 39.8 })).toEqual([]);
    expect(await errs(RecordRateDto, { rate: '39.8' })).toEqual(['rate']);
    expect(await errs(RecordRateDto, { rate: 0 })).toEqual(['rate']);
    expect(await errs(RecordRateDto, { rate: [1] })).toEqual(['rate']);
    expect(await errs(RecordRateDto, { rate: 1, confirm: 'yes' })).toEqual(['confirm']);
  });
});
