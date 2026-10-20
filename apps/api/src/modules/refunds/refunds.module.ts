import { Module } from '@nestjs/common';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';
import { WalletModule } from '../wallet/wallet.module';
import { PaymentsModule } from '../payments/payments.module';

/**
 * Depends on PaymentsModule (for GatewayRegistry) in one direction only.
 * No forwardRef: the cycle was removed rather than tolerated.
 */
@Module({
  imports: [WalletModule, PaymentsModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
