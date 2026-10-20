import { WalletController } from '../../src/modules/wallet/wallet.controller';

describe('WalletController', () => {
  let wallet: any;
  let controller: WalletController;

  beforeEach(() => {
    wallet = {
      listForUser: jest.fn().mockReturnValue([{ id: 'w1' }]),
      history: jest.fn().mockReturnValue([{ id: 't1' }]),
      adjust: jest.fn().mockResolvedValue({ balanceAfter: '125' }),
    };
    controller = new WalletController(wallet);
  });

  it('lists the caller-owned wallets', () => {
    expect(controller.balances('u1')).toEqual([{ id: 'w1' }]);
    expect(wallet.listForUser).toHaveBeenCalledWith('u1');
  });

  it('passes the optional currency filter through to history', () => {
    void controller.history('u1', 'USD');
    expect(wallet.history).toHaveBeenCalledWith('u1', 'USD');
  });

  it('reads all history when no currency filter is given', () => {
    void controller.history('u1', undefined);
    expect(wallet.history).toHaveBeenCalledWith('u1', undefined);
  });

  it('adjusts a wallet with the acting operator recorded as actor', async () => {
    const dto = { userId: 'target', currency: 'USD', amount: 25, reason: 'goodwill' } as any;
    const res = await controller.adjust(dto, 'admin-1');
    expect(wallet.adjust).toHaveBeenCalledWith('target', 'USD', 25, 'goodwill', 'admin-1');
    expect(res).toEqual({ balanceAfter: '125' });
  });
});
