import { Module } from '@nestjs/common';
import { PaymentsAdminController, PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { GatewayRegistry } from './gateways/gateway.registry';
import { WalletGateway } from './gateways/wallet.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { ManualTransferGateway } from './gateways/manual.gateway';
import { WalletModule } from '../wallet/wallet.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [WalletModule, UploadsModule],
  controllers: [PaymentsController, PaymentsAdminController, WebhooksController],
  providers: [PaymentsService, GatewayRegistry, WalletGateway, StripeGateway, ManualTransferGateway],
  exports: [PaymentsService, GatewayRegistry],
})
export class PaymentsModule {}
