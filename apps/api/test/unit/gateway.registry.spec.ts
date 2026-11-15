import { BadRequestException } from '@nestjs/common';
import { GatewayRegistry } from '../../src/modules/payments/gateways/gateway.registry';

describe('GatewayRegistry', () => {
  let moduleRef: any;
  let registry: GatewayRegistry;

  const wallet = { code: 'WALLET' };
  const stripe = { code: 'STRIPE', isEnabled: jest.fn().mockReturnValue(false) };
  const manual = { code: 'MANUAL', isEnabled: jest.fn().mockResolvedValue(true) };

  beforeEach(() => {
    // onModuleInit iterates [WalletGateway, StripeGateway, ManualTransferGateway] in order; the
    // constructor argument identity is irrelevant to the mock, only call order.
    moduleRef = { get: jest.fn().mockReturnValueOnce(wallet).mockReturnValueOnce(stripe).mockReturnValueOnce(manual) };
    registry = new GatewayRegistry(moduleRef);
    registry.onModuleInit();
  });

  it('registers each gateway under its own code on init', () => {
    expect(moduleRef.get).toHaveBeenCalledTimes(3);
    expect(registry.get('WALLET')).toBe(wallet);
    expect(registry.get('STRIPE')).toBe(stripe);
  });

  it('resolves gateways by their enum code as well as raw string', () => {
    expect(registry.get('WALLET' as any)).toBe(wallet);
  });

  it('throws BadRequestException for an unknown gateway code', () => {
    expect(() => registry.get('BITCOIN')).toThrow(BadRequestException);
    expect(() => registry.get('BITCOIN')).toThrow('Payment method "BITCOIN" is not available');
  });

  it('lists every registered code', () => {
    expect(registry.listCodes()).toEqual(['WALLET', 'STRIPE', 'MANUAL']);
  });

  it('offers only enabled gateways: Stripe without keys and manual without accounts are hidden', async () => {
    await expect(registry.listEnabledCodes()).resolves.toEqual(['WALLET', 'MANUAL']);
    manual.isEnabled.mockResolvedValueOnce(false);
    await expect(registry.listEnabledCodes()).resolves.toEqual(['WALLET']);
  });

  it('uses a non-strict module lookup so cross-module providers resolve', () => {
    expect(moduleRef.get.mock.calls[0][1]).toEqual({ strict: false });
  });
});
