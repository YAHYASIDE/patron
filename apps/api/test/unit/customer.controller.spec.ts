import { MeController, StoreFactsController } from '../../src/modules/customer/customer.controller';
import { WatchesProcessor, CHECK_WATCHES_JOB } from '../../src/modules/queues/processors/watches.processor';

describe('MeController', () => {
  let customer: any;
  let watches: any;
  let controller: MeController;

  beforeEach(() => {
    customer = {
      listSavedInputs: jest.fn().mockResolvedValue([]),
      saveInput: jest.fn().mockResolvedValue({ id: 's1' }),
      deleteSavedInput: jest.fn().mockResolvedValue({ deleted: true }),
      listFavorites: jest.fn().mockResolvedValue(['g-pubg-mobile']),
      addFavorite: jest.fn().mockResolvedValue({ brandKey: 'g-pubg-mobile' }),
      removeFavorite: jest.fn().mockResolvedValue({ deleted: true }),
      myCodes: jest.fn().mockResolvedValue([]),
    };
    watches = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'w1' }),
      remove: jest.fn().mockResolvedValue({ deleted: true }),
    };
    controller = new MeController(customer, watches);
  });

  it('routes saved inputs to the service with the caller id', async () => {
    await controller.savedInputs('u1', { gameId: 'g1' });
    expect(customer.listSavedInputs).toHaveBeenCalledWith('u1', 'g1');
    const dto = { gameId: 'g1', values: { playerId: '1' } };
    await controller.saveInput('u1', dto);
    expect(customer.saveInput).toHaveBeenCalledWith('u1', dto);
    await controller.deleteInput('u1', 's1');
    expect(customer.deleteSavedInput).toHaveBeenCalledWith('u1', 's1');
  });

  it('routes favourites', async () => {
    await expect(controller.favorites('u1')).resolves.toEqual(['g-pubg-mobile']);
    await controller.addFavorite('u1', 'g-pubg-mobile');
    expect(customer.addFavorite).toHaveBeenCalledWith('u1', 'g-pubg-mobile');
    await controller.removeFavorite('u1', 'g-pubg-mobile');
    expect(customer.removeFavorite).toHaveBeenCalledWith('u1', 'g-pubg-mobile');
  });

  it('routes watches and codes', async () => {
    await controller.watchList('u1');
    expect(watches.list).toHaveBeenCalledWith('u1');
    await controller.watch('u1', { productId: 'p1', kind: 'price' });
    expect(watches.create).toHaveBeenCalledWith('u1', { productId: 'p1', kind: 'price' });
    await controller.unwatch('u1', 'w1');
    expect(watches.remove).toHaveBeenCalledWith('u1', 'w1');
    await controller.codes('u1');
    expect(customer.myCodes).toHaveBeenCalledWith('u1');
  });
});

describe('StoreFactsController', () => {
  it('passes the limit through with a default of 8', async () => {
    const facts: any = {
      bestSellers: jest.fn().mockResolvedValue([]),
      stats: jest.fn().mockResolvedValue({ ordersDelivered: 1, customers: 2 }),
      rates: jest.fn().mockResolvedValue({ base: 'USD', rates: {} }),
    };
    const controller = new StoreFactsController(facts);
    await controller.bestSellers({});
    await controller.bestSellers({ limit: 3 });
    expect(facts.bestSellers.mock.calls).toEqual([[8], [3]]);
    await expect(controller.stats()).resolves.toEqual({ ordersDelivered: 1, customers: 2 });
    await expect(controller.rates()).resolves.toEqual({ base: 'USD', rates: {} });
  });
});

describe('WatchesProcessor', () => {
  it('runs the sweep and rejects unknown jobs', async () => {
    const watches: any = { runChecks: jest.fn().mockResolvedValue({ checked: 1, notified: 1 }) };
    const processor = new WatchesProcessor(watches);
    await expect(processor.process({ name: CHECK_WATCHES_JOB } as any)).resolves.toEqual({ checked: 1, notified: 1 });
    expect(() => processor.process({ name: 'other' } as any)).toThrow('Unknown watches job "other"');
  });
});
