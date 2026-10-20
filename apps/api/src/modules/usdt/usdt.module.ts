import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { UsdtAdminController, UsdtController } from './usdt.controller';
import { UsdtService } from './usdt.service';
import { UsdtConfigService } from './usdt-config.service';
import { USDT_QUEUE, UsdtExpiryProcessor } from './usdt-expiry.processor';

/**
 * Customers buying USDT: quotes, orders with frozen totals, the transfer
 * receipt, staff review and the TXID of the hand-made transfer. Off until the
 * owner switches it on (`usdt.config.enabled`).
 */
@Module({
  imports: [BullModule.registerQueue({ name: USDT_QUEUE })],
  controllers: [UsdtController, UsdtAdminController],
  providers: [UsdtService, UsdtConfigService, UsdtExpiryProcessor],
  exports: [UsdtService, UsdtConfigService],
})
export class UsdtModule {}
