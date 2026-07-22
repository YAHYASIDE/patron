import { FxController } from '../../src/modules/fx/fx.controller';

describe('FxController', () => {
  let fx: any;
  let controller: FxController;

  beforeEach(() => {
    fx = {
      history: jest.fn().mockReturnValue([{ id: 'r1' }]),
      findStale: jest.fn().mockResolvedValue(['EUR', 'GBP']),
      recordRate: jest.fn().mockResolvedValue({ id: 'r2' }),
    };
    controller = new FxController(fx);
  });

  it('normalises the currency to upper case when reading history', () => {
    const res = controller.history('eur');
    expect(fx.history).toHaveBeenCalledWith('EUR');
    expect(res).toEqual([{ id: 'r1' }]);
  });

  it('wraps the stale currency list under a stale key', async () => {
    const res = await controller.stale();
    expect(fx.findStale).toHaveBeenCalled();
    expect(res).toEqual({ stale: ['EUR', 'GBP'] });
  });

  it('records a MANUAL rate under the acting operator with an upper-cased currency', async () => {
    const res = await controller.record('gbp', 0.8, 'admin-1');
    expect(fx.recordRate).toHaveBeenCalledWith('GBP', 0.8, 'MANUAL', 'admin-1');
    expect(res).toEqual({ id: 'r2' });
  });
});
