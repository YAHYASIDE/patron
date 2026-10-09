import { ProvidersController } from '../../src/modules/providers/providers.controller';

describe('ProvidersController', () => {
  let providers: any;
  let engine: any;
  let controller: ProvidersController;

  beforeEach(() => {
    providers = {
      findAll: jest.fn().mockResolvedValue([{ id: 'p1' }]),
      runHealthChecks: jest.fn().mockResolvedValue([{ code: 'fazercards', healthy: true }]),
      rotateKey: jest.fn().mockResolvedValue({ message: 'Credentials rotated' }),
    };
    engine = { fulfilItem: jest.fn().mockResolvedValue({ status: 'DELIVERED' }) };
    controller = new ProvidersController(providers, engine);
  });

  it('lists providers', async () => {
    expect(await controller.findAll()).toEqual([{ id: 'p1' }]);
  });

  it('triggers a health-check sweep', async () => {
    expect(await controller.healthCheck()).toEqual([{ code: 'fazercards', healthy: true }]);
    expect(providers.runHealthChecks).toHaveBeenCalled();
  });

  it('rotates a provider key with the acting operator', async () => {
    const res = await controller.rotateKey('p1', 'k', 's', 'admin-1');
    expect(providers.rotateKey).toHaveBeenCalledWith('p1', 'k', 's', 'admin-1');
    expect(res).toEqual({ message: 'Credentials rotated' });
  });

  it('retries fulfilment, forwarding an optional pinned provider', async () => {
    await controller.retry('item-1', 'prov-2');
    expect(engine.fulfilItem).toHaveBeenCalledWith('item-1', 'prov-2');
  });

  it('retries without a pinned provider when none is given', async () => {
    await controller.retry('item-1', undefined);
    expect(engine.fulfilItem).toHaveBeenCalledWith('item-1', undefined);
  });
});
