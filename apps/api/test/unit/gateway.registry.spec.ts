import { BadRequestException } from '@nestjs/common';
import { GatewayRegistry } from '../../src/modules/payments/gateways/gateway.registry';

describe('GatewayRegistry', () => {
  let moduleRef: any;
  let registry: GatewayRegistry;

  const wallet = { code: 'WALLET' };
  const stripe = { code: 'STRIPE' };

  beforeEach(() => {
    // onModuleInit iterates [WalletGateway, StripeGateway] in order; the
    // constructor argument identity is irrelevant to the mock, only call order.
    moduleRef = { get: jest.fn().mockReturnValueOnce(wallet).mockReturnValueOnce(stripe) };
    registry = new GatewayRegistry(moduleRef);
    registry.onModuleInit();
  });

  it('registers each gateway under its own code on init', () => {
    expect(moduleRef.get).toHaveBeenCalledTimes(2);
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
    expect(registry.listCodes()).toEqual(['WALLET', 'STRIPE']);
  });

  it('uses a non-strict module lookup so cross-module providers resolve', () => {
    expect(moduleRef.get.mock.calls[0][1]).toEqual({ strict: false });
  });
});
