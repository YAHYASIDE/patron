import { Module } from '@nestjs/common';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { GatewayRegistry } from './gateways/gateway.registry';
import { WalletGateway } from './gateways/wallet.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  imports: [WalletModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsService, GatewayRegistry, WalletGateway, StripeGateway],
  exports: [PaymentsService, GatewayRegistry],
})
export class PaymentsModule {}
