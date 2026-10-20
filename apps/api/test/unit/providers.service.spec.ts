import { ProvidersService } from '../../src/modules/providers/providers.service';

describe('ProvidersService', () => {
  let prisma: any;
  let registry: any;
  let crypto: any;
  let adapter: any;
  let service: ProvidersService;

  beforeEach(() => {
    adapter = {
      healthCheck: jest.fn().mockResolvedValue(true),
      getBalance: jest.fn().mockResolvedValue({ balance: 500, currency: 'USD' }),
    };
    prisma = {
      provider: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    registry = {
      credentialsFor: jest.fn().mockResolvedValue({ adapter, creds: { apiKey: 'k' } }),
    };
    crypto = { encrypt: jest.fn((v: string) => `enc(${v})`) };
    service = new ProvidersService(prisma, registry, crypto);
  });

  describe('findAll', () => {
    it('never selects any credential column', async () => {
      await service.findAll();
      const { select } = prisma.provider.findMany.mock.calls[0][0];
      expect(select.apiKeyEnc).toBeUndefined();
      expect(select.apiSecretEnc).toBeUndefined();
      expect(select.code).toBe(true);
      expect(prisma.provider.findMany.mock.calls[0][0].orderBy).toEqual({ priority: 'asc' });
    });
  });

  describe('rotateKey', () => {
    it('encrypts both key and secret and audits the rotation', async () => {
      const res = await service.rotateKey('p1', 'newkey', 'newsecret', 'admin-1');

      const { data } = prisma.provider.update.mock.calls[0][0];
      expect(data.apiKeyEnc).toBe('enc(newkey)');
      expect(data.apiSecretEnc).toBe('enc(newsecret)');
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'providers.rotate_key', entityId: 'p1', userId: 'admin-1' }),
        }),
      );
      expect(res).toEqual({ message: 'Credentials rotated' });
    });

    it('leaves the secret untouched when none is supplied', async () => {
      await service.rotateKey('p1', 'newkey', undefined, 'admin-1');
      expect(prisma.provider.update.mock.calls[0][0].data.apiSecretEnc).toBeUndefined();
      expect(crypto.encrypt).toHaveBeenCalledTimes(1);
    });
  });

  describe('runHealthChecks', () => {
    it('marks a provider healthy and refreshes its balance', async () => {
      prisma.provider.findMany.mockResolvedValue([
        { id: 'p1', code: 'fazercards', lowBalanceAlert: null },
      ]);

      const res = await service.runHealthChecks();

      expect(res).toEqual([{ code: 'fazercards', healthy: true }]);
      // one update for balance, one for health flag
      expect(prisma.provider.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { balance: 500 } });
      const healthUpdate = prisma.provider.update.mock.calls.find(
        (c: any) => c[0].data.isHealthy !== undefined,
      );
      expect(healthUpdate[0].data.isHealthy).toBe(true);
    });

    it('warns but stays healthy when the balance is under the low-balance alert', async () => {
      prisma.provider.findMany.mockResolvedValue([
        { id: 'p1', code: 'fazercards', lowBalanceAlert: '1000' },
      ]);
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);

      await service.runHealthChecks();

      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/balance is low/));
    });

    it('still marks healthy when balance lookup fails', async () => {
      prisma.provider.findMany.mockResolvedValue([{ id: 'p1', code: 'fazercards', lowBalanceAlert: null }]);
      adapter.getBalance.mockRejectedValue(new Error('boom'));

      const res = await service.runHealthChecks();

      expect(res).toEqual([{ code: 'fazercards', healthy: true }]);
      // no balance update; only the health flag update
      expect(prisma.provider.update).toHaveBeenCalledTimes(1);
      expect(prisma.provider.update.mock.calls[0][0].data.isHealthy).toBe(true);
    });

    it('marks a provider unhealthy when the health probe returns false', async () => {
      prisma.provider.findMany.mockResolvedValue([{ id: 'p1', code: 'foxreload', lowBalanceAlert: null }]);
      adapter.healthCheck.mockResolvedValue(false);

      const res = await service.runHealthChecks();

      expect(res).toEqual([{ code: 'foxreload', healthy: false }]);
      expect(adapter.getBalance).not.toHaveBeenCalled();
      expect(prisma.provider.update.mock.calls[0][0].data.isHealthy).toBe(false);
    });

    it('treats a credentials/adapter error as unhealthy without crashing the sweep', async () => {
      prisma.provider.findMany.mockResolvedValue([{ id: 'p1', code: 'foxreload', lowBalanceAlert: null }]);
      registry.credentialsFor.mockRejectedValue(new Error('no adapter'));
      jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      const res = await service.runHealthChecks();

      expect(res).toEqual([{ code: 'foxreload', healthy: false }]);
      expect(prisma.provider.update.mock.calls[0][0].data.isHealthy).toBe(false);
    });
  });
});
