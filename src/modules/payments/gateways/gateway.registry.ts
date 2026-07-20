import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PaymentGateway as GatewayEnum } from '@prisma/client';
import { PaymentGateway } from './payment-gateway.interface';
import { WalletGateway } from './wallet.gateway';
import { StripeGateway } from './stripe.gateway';

@Injectable()
export class GatewayRegistry implements OnModuleInit {
  private readonly gateways = new Map<string, PaymentGateway>();

  constructor(private moduleRef: ModuleRef) {}

  onModuleInit() {
    for (const type of [WalletGateway, StripeGateway]) {
      const gateway = this.moduleRef.get(type, { strict: false });
      this.gateways.set(gateway.code, gateway);
    }
  }

  get(code: GatewayEnum | string): PaymentGateway {
    const gateway = this.gateways.get(code);
    if (!gateway) throw new BadRequestException(`Payment method "${code}" is not available`);
    return gateway;
  }

  listCodes() {
    return [...this.gateways.keys()];
  }
}
